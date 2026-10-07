export const meta = {
  name: 'port-pyyaml-to-node',
  description: 'Build a zero-dependency ESM Node port of a Python yaml.dump(eval(x)) script, then differential-test it to byte parity',
  phases: [
    { title: 'Build', detail: 'parallel agents write each library module' },
    { title: 'Integrate', detail: 'wire test2.mjs, resolve interface mismatches, smoke test' },
    { title: 'Difftest', detail: 'category agents diff node output vs the reference binary' },
    { title: 'Fix', detail: 'apply fixes for confirmed mismatches' },
  ],
}

const PREAMBLE = `You are implementing part of a Node.js (ESM, zero-dependency) port of a Python script.

FIRST: read /workspace/CONTRACT.md in full. It is the authoritative spec.
ALSO read /output/lib/pyvalues.mjs — the shared value model, already written. Do NOT modify it
(if you find an actual bug in it, report it in your final message instead of editing).

HARD RULES (violating any of these invalidates the whole deliverable):
- ESM only: 'import'/'export'. Never 'require', never 'module.exports'.
- All files end in .mjs and every relative import includes the .mjs suffix.
- Zero npm packages. Only node: builtins, and only if genuinely needed.
- The identifier JSON must never appear in your code. No JSON.parse/JSON.stringify.
- RegExp is forbidden: no /regex/ literals, no new RegExp, and no String method call that
  takes a regex (.match/.matchAll/.search/.test, or .replace/.split with a regex).
  String .split/.replace/.startsWith/.endsWith/.indexOf/.slice/.charCodeAt with plain
  STRING arguments are fine. All pattern matching must be hand-written character loops.
- Do not shell out to python and do not embed Python.

You can observe the reference behaviour any time with:
  /workspace/dataset/test2_executable --a "<python expression>"
Never run the 'python' command. Use the binary.

Write clean, well-organised code with brief comments explaining the PyYAML/CPython
behaviour being mirrored. Only create the files assigned to you.`

const MODULES = [
  {
    key: 'repr-argparse',
    files: '/output/lib/pyrepr.mjs and /output/lib/argparse.mjs',
    spec: `MODULE 1 — /output/lib/pyrepr.mjs
Exports (exact names):
  export function pyFloatRepr(x)      // CPython repr(float) -> string, e.g. 1e16 -> "1e+16",
                                      // 1e15 -> "1000000000000000.0", 1e-5 -> "1e-05",
                                      // 5e-324 -> "5e-324", -0.0 -> "-0.0", 0.0 -> "0.0",
                                      // Infinity -> "inf", -Infinity -> "-inf", NaN -> "nan"
  export function pyIntRepr(b)        // BigInt -> decimal string
  export function pyRepr(v)           // CPython repr() for any value in the value model
  export function pyStr(v)            // CPython str() for any value in the value model
  export function base64Encodebytes(u8)  // == Python base64.encodebytes(...).decode('ascii')

pyFloatRepr algorithm (must be exact, no RegExp):
  Use Number.prototype.toExponential() with NO argument -> that yields the shortest
  round-trip digit string, e.g. (0.1).toExponential() === "1e-1". Hand-parse that string
  (find 'e', split mantissa/exponent, strip the '.') to get:
     digits = mantissa digits without the dot (no leading '-')
     decpt  = exponent + 1
  use_exp = (decpt <= -4 || decpt > 16)
  If use_exp: digits[0] + (digits.length>1 ? '.' + digits.slice(1) : '') + 'e'
              + (exp>=0 ? '+' : '-') + abs(exp) zero-padded to at least 2 digits,
              where exp = decpt - 1.
  Else fixed:  decpt <= 0            -> '0.' + '0'.repeat(-decpt) + digits
               decpt >= digits.length -> digits + '0'.repeat(decpt-digits.length) + '.0'
               else                   -> digits.slice(0,decpt) + '.' + digits.slice(decpt)
  Prefix '-' when the value is negative (including -0.0, detect via Object.is or 1/x<0).
  Verify against the binary: --a 1e15, 1e16, 1e-4, 1e-5, 0.1+0.2, 1/3, 2.0, -0.0,
  5e-324, 1e-323, 1.7976931348623157e308, float(2**53), 123456789012345678.0.
  (Note PyYAML then lowercases and inserts '.0' before 'e' when there is no '.', so
  pyFloatRepr itself must NOT add that '.0' — return exactly CPython's repr.)

pyRepr must handle: str (Python quoting rules: prefer single quotes; use double quotes
if the string contains a single quote and no double quote; escape \\\\ \\n \\r \\t and
non-printables as \\xHH/\\uHHHH/\\UHHHHHHHH), bigint, number (via pyFloatRepr), PyBool
('True'/'False'), PyNone ('None'), PyBytes (b'...'), PyList, PyTuple (1-tuple gets a
trailing comma), PySet ('set()' when empty), PyFrozenSet, PyDict, PyComplex
(e.g. '(1+2j)'), PyRange ('range(0, 3)'), and a generic '<object ...>' fallback.
pyStr(v) equals pyRepr(v) for everything except str (returns the string itself).

base64Encodebytes: standard base64 alphabet A-Za-z0-9+/ with '=' padding, emit a '\\n'
after every 76 characters of output and a trailing '\\n'; empty input -> '' (empty string,
no newline). Verify: --a 'b"x"*100' and --a 'b"x"' and --a 'b""'.

MODULE 2 — /output/lib/argparse.mjs
A faithful-enough subset of Python's argparse for exactly this parser:
  parser = argparse.ArgumentParser(); parser.add_argument('--a', type=str, required=True)
Exports:
  export const PROG = 'test2_executable'
  export const USAGE = 'usage: test2_executable [-h] --a A'
  export function parseArgs(argv)   // argv = array of args AFTER the program name.
                                    // returns { a: '<string>' } on success.
Behaviour (see the table in CONTRACT.md, and re-verify each row against the binary):
  - '--a VALUE' and '--a=VALUE' both work; later occurrences overwrite earlier ones.
  - A token starting with '-' is treated as a VALUE (not an option) only when it matches
    argparse's negative-number test: '-' followed by one or more digits, OR '-' followed
    by zero or more digits, '.', then one or more digits. Implement this WITHOUT RegExp.
    Also a token that is exactly '-' or contains a space is treated as a value.
  - Otherwise a token starting with '-' (and longer than 1 char) is an option; if it is
    unknown it goes to the 'unrecognized arguments' list.
  - '--' terminates option parsing; the '--' itself is dropped and the rest are positionals.
  - '-h'/'--help' prints the help text to stdout and exits 0.
  - Missing --a  -> stderr: USAGE + '\\n' then
      'test2_executable: error: the following arguments are required: --a\\n', exit 2.
    This is reported BEFORE unrecognized-argument errors.
  - '--a' with no following value -> stderr USAGE +
      'test2_executable: error: argument --a: expected one argument\\n', exit 2.
  - Leftover tokens -> 'test2_executable: error: unrecognized arguments: <tokens joined by space>'
    exit 2.
  - Long-option prefix abbreviation is enabled, but '--a' is the only long option, so
    only the exact '--a' (or a prefix match of '--a', i.e. nothing else) matches.
  Help text exactly:
      usage: test2_executable [-h] --a A

      options:
        -h, --help  show this help message and exit
        --a A
  Use process.stdout.write / process.stderr.write and process.exit. Import from
  'node:process'. Export a small hook so the entry file can override exit if it wants,
  but the default must exit the process.`,
  },
  {
    key: 'tokenizer-parser',
    files: '/output/lib/python/tokenizer.mjs and /output/lib/python/parser.mjs',
    spec: `MODULE — the Python expression front end. You write BOTH files.

/output/lib/python/tokenizer.mjs
  export function tokenize(src)  // -> array of tokens
  Token: { type, value, start, end, line }
    type is one of 'NAME' | 'NUMBER' | 'STRING' | 'OP' | 'EOF'
    For NUMBER, also set: { numKind: 'int'|'float'|'imaginary', numValue }
      numValue is a BigInt for 'int', a Number for 'float', a Number for 'imaginary'.
    For STRING, also set: { strValue, isBytes, isFString, fParts } where strValue is the
      decoded JS string (or a Uint8Array-compatible array of byte values when isBytes),
      and fParts (only when isFString) is an array of
        { kind: 'lit', text } | { kind: 'expr', src, conversion, formatSpec }.
    Implicit adjacent string literal concatenation must be handled (either here or in the
    parser) — 'ab' 'cd' === 'abcd'.
  Number syntax: decimal ints with '_' separators, 0x/0X hex, 0o/0O octal, 0b/0B binary,
  floats ('1.', '.5', '1_0.5', '1e5', '1E-5', '1.5e+3'), imaginary suffix 'j'/'J'.
  Leading zeros like '012' are a SyntaxError in Python 3 — but do NOT bother replicating
  that; just accept it as 12 (low priority).
  String syntax: '...', "...", '''...''', """...""", prefixes r R b B u U f F and the
  two-letter combinations rb br Rb bR fr rf etc. Escapes in non-raw strings:
    \\\\ \\' \\" \\a \\b \\f \\n \\r \\t \\v \\0-\\777 (octal) \\xHH
    and, for str only, \\uHHHH \\UHHHHHHHH \\N{NAME} (for \\N{...} you may support just a
    tiny table or throw a clear error). A backslash-newline is a line continuation.
    An unknown escape keeps the backslash, as CPython does.
  Operators/delimiters (longest match first):
    ** // << >> <= >= == != := -> ... and all single chars + - * / % @ & | ^ ~ < > = ( ) [ ] { } , : . ;
  Whitespace and '#' comments are skipped; newlines inside brackets are insignificant.
  Since the source is always a single-line expression, you may treat newlines as
  whitespace generally.
  On bad input throw a PyError from ../pyvalues.mjs with pyName 'SyntaxError' and
  pyMessage 'invalid syntax'; attach .lineno (1-based) and .text (the offending source line)
  and .offset if you can.

/output/lib/python/parser.mjs
  export function parseExpression(src)  // -> AST root node; throws SyntaxError PyError
  A recursive-descent parser for the Python 3 expression grammar. Trailing whitespace and
  a trailing ';' are NOT allowed (Python's eval rejects statements) — anything left over
  after the expression is a SyntaxError. An empty/whitespace-only source is a SyntaxError
  with lineno 0 and text ''.
  AST node shapes (plain objects, use exactly these 'type' tags and field names — the
  evaluator is written against them by another agent, so do not deviate):
    { type:'Constant', value }                       // value is already a value-model value
    { type:'Name', id }
    { type:'Tuple', elts }                           // elts: array of nodes (or Starred)
    { type:'List', elts }
    { type:'Set', elts }
    { type:'Dict', keys, values }                    // keys[i] === null means **values[i]
    { type:'Starred', value }
    { type:'BinOp', op, left, right }                // op: '+','-','*','/','//','%','**','@','|','^','&','<<','>>'
    { type:'UnaryOp', op, operand }                  // op: '+','-','~','not'
    { type:'BoolOp', op, values }                    // op: 'and' | 'or'
    { type:'Compare', left, ops, comparators }       // ops: '<','<=','>','>=','==','!=','in','not in','is','is not'
    { type:'IfExp', test, body, orelse }
    { type:'Lambda', args, body }                    // args: { params:[{name, default|null}], vararg, kwarg }
    { type:'Call', func, args, keywords }            // args may contain Starred;
                                                     // keywords: [{ arg|null, value }] (null arg == **kwargs)
    { type:'Attribute', value, attr }
    { type:'Subscript', value, slice }
    { type:'Slice', lower, upper, step }             // any may be null
    { type:'JoinedStr', values }                     // values: Constant | FormattedValue
    { type:'FormattedValue', value, conversion, formatSpec }
    { type:'ListComp'|'SetComp'|'GeneratorExp', elt, generators }
    { type:'DictComp', key, value, generators }
    generators: [{ target, iter, ifs }] where target is a Name or a Tuple/List of targets
  Precedence, lowest to highest: lambda / IfExp, or, and, not, comparison (chained),
  |, ^, &, << >>, + -, * / // % @, unary + - ~, ** (right associative, and its RIGHT
  operand may be a unary expression: 2**-1 parses), then trailers (call/subscript/attr).
  Note '-2**2' == -(2**2).`,
  },
  {
    key: 'evaluator',
    files: '/output/lib/python/operators.mjs, /output/lib/python/builtins.mjs and /output/lib/python/evaluator.mjs',
    spec: `MODULE — the Python evaluator. You write THREE files. Another agent is writing
/output/lib/python/tokenizer.mjs and /output/lib/python/parser.mjs against the AST shapes
listed below; code against those shapes and just import { parseExpression } from './parser.mjs'.
If parser.mjs does not exist yet, still write your code against the documented shapes.

AST node shapes you must handle (exact 'type' tags and field names):
  Constant{value} Name{id} Tuple{elts} List{elts} Set{elts} Dict{keys,values} Starred{value}
  BinOp{op,left,right} UnaryOp{op,operand} BoolOp{op,values}
  Compare{left,ops,comparators} IfExp{test,body,orelse} Lambda{args,body}
  Call{func,args,keywords} Attribute{value,attr} Subscript{value,slice}
  Slice{lower,upper,step} JoinedStr{values} FormattedValue{value,conversion,formatSpec}
  ListComp/SetComp/GeneratorExp{elt,generators} DictComp{key,value,generators}
  generators: [{ target, iter, ifs }]
  Dict keys[i] === null means '**' unpacking of values[i].
  Call keywords: [{ arg, value }] with arg === null meaning '**kwargs'.

/output/lib/python/operators.mjs
  export function binaryOp(op, a, b)
  export function unaryOp(op, a)
  export function compareOp(op, a, b)     // returns a JS boolean
  export function getItem(obj, index)     // index may be a PySlice
  export function setItem(obj, index, v)
  export function iterate(v)              // -> JS array of values; TypeError if not iterable
  export function contains(container, item)
  Numeric tower rules (critical):
   - int is BigInt, float is Number, bool is PyBool (acts as 1/0 and, for '+'/'*' etc.,
     produces int not bool).
   - int OP int stays int, EXCEPT '/' which always produces float.
   - '//' and '%' use FLOOR semantics like Python: (-7)//2 === -4n, (-7)%2 === 1n,
     7//-2 === -4n, 7%-2 === -1n. Same for floats (use Math.floor / fmod-with-sign).
   - '**': int**nonneg-int -> exact BigInt; int**neg-int -> float; float involved -> float;
     0**0 === 1n; negative base to a fractional power -> complex in Python; you may
     produce a PyComplex or raise, whichever is simpler (document it).
   - divide by zero -> PyError 'ZeroDivisionError' with message 'division by zero'
     for '/', 'integer division or modulo by zero' for '//' and '%' on ints,
     'float division by zero' / 'float floor division by zero' /
     'float modulo' as CPython does (verify a couple against the binary).
   - str + str, str * int (n<=0 -> ''), list/tuple + same, list/tuple * int.
     IMPORTANT: list*n and [x]*n must REUSE the same element objects (no copying) —
     PyYAML's aliasing depends on object identity, e.g. --a '[[1]]*2' must emit &id001/*id001.
   - '%' on a str is printf-style formatting: support at least %s %r %d %i %f %x %X %o %e
     %g %c %% with optional flags/width/precision, and a PyTuple or single value on the
     right, and %(name)s with a PyDict. Implement WITHOUT RegExp.
   - '+'/'*' etc. on unsupported type pairs -> TypeError with a CPython-shaped message.
  compareOp: '==','!=' use pyEq; '<','<=','>','>=' use pyCompare (which raises TypeError
  for incomparable operands); 'is'/'is not' use JS identity, except that small ints,
  interned strs, True/False/None must behave sensibly (PY_TRUE/PY_FALSE/PY_NONE are
  singletons so identity works; for BigInt use ===; for strings use ===).
  'in'/'not in' use contains.
  getItem: negative indices, IndexError 'list index out of range', KeyError for dict
  (message is repr(key)), str indexing by CODE POINT (use chars() from pyvalues.mjs),
  slices with negative/absent bounds and negative steps, on str/list/tuple/bytes/range.

/output/lib/python/builtins.mjs
  export const BUILTINS         // Map<string, value> of the builtin namespace
  export function getAttribute(obj, name)   // -> PyBoundMethod or value; AttributeError otherwise
  Builtins to provide: abs all any bin bool bytes bytearray chr complex dict divmod
  enumerate filter float format frozenset hex id int isinstance len list map max min oct
  ord pow print range repr reversed round set slice sorted str sum tuple type zip object
  True False None Ellipsis NotImplemented (the last two as sensible stand-ins).
  Notes: int() accepts str with optional base, float() accepts 'inf','-inf','nan','infinity'
  (case-insensitive) and numeric strings; round() uses banker's rounding like Python and
  returns int with no ndigits; sorted() must accept key= and reverse= and must propagate
  TypeError for incomparable elements; max/min accept key= and default=; sum accepts start=.
  Methods via getAttribute, at minimum:
    str: upper lower strip lstrip rstrip split rsplit splitlines join replace startswith
         endswith find rfind index count title capitalize swapcase format format_map zfill
         ljust rjust center encode isdigit isalpha isalnum isspace isupper islower removeprefix
         removesuffix partition
    list: append extend insert pop remove index count sort reverse copy clear
    dict: get keys values items copy setdefault pop popitem update clear fromkeys
    set/frozenset: add discard remove union intersection difference symmetric_difference
         issubset issuperset copy update
    bytes: decode hex
    int: bit_length to_bytes(optional)
    float: is_integer hex(optional)
  str.format must support {}, {0}, {name}, {0.attr}, {0[k]}, and the common format specs
  (fill/align/sign/width/precision/type for d f s e g x o b %). Implement without RegExp.
  Keep it reasonable — breadth matters more than exotic corner cases.

/output/lib/python/evaluator.mjs
  export function pyEval(source)   // parse + evaluate, returns a value-model value
  Implements evaluation of every AST node above, with a scope chain for lambda and
  comprehensions (comprehensions get their own scope; the iteration variable does not
  leak). Unknown Name -> PyError 'NameError' with message "name 'x' is not defined".
  Calling a non-callable -> TypeError "'int' object is not callable" style.
  Chained comparisons short-circuit and evaluate each operand once.`,
  },
  {
    key: 'yaml-front',
    files: '/output/lib/yaml/nodes.mjs, events.mjs, resolver.mjs, representer.mjs, serializer.mjs, dumper.mjs',
    spec: `MODULE — the PyYAML front half. You write SIX files under /output/lib/yaml/.
Another agent writes /output/lib/yaml/emitter.mjs; code against the interface below.

/output/lib/yaml/nodes.mjs
  export class Node { constructor(tag, value, style=null) }
  export class ScalarNode extends Node   // .style is null | '' | "'" | '"' | '|' | '>'
  export class SequenceNode extends Node // .value is an array of Nodes; .flowStyle
  export class MappingNode extends Node  // .value is an array of [keyNode, valueNode]; .flowStyle
  export const TAG = { str:'tag:yaml.org,2002:str', int:…, float:…, bool:…, null:…,
                       seq:…, map:…, set:…, binary:…, pythonTuple:'tag:yaml.org,2002:python/tuple',
                       pythonComplex:'tag:yaml.org,2002:python/complex', … }

/output/lib/yaml/events.mjs
  Plain classes mirroring PyYAML's events, with exactly these fields:
    StreamStartEvent{encoding}  StreamEndEvent{}
    DocumentStartEvent{explicit, version, tags}  DocumentEndEvent{explicit}
    AliasEvent{anchor}
    ScalarEvent{anchor, tag, implicit, value, style}     // implicit is [bool, bool]
    SequenceStartEvent{anchor, tag, implicit, flowStyle}  SequenceEndEvent{}
    MappingStartEvent{anchor, tag, implicit, flowStyle}   MappingEndEvent{}
  Give each class a static/instance discriminant the emitter can switch on, e.g.
  a readonly 'kind' string field ('StreamStart', 'ScalarEvent', …) AND keep the classes
  exported so instanceof works. Also export helper predicates
  isNodeEvent(e) / isCollectionStartEvent(e) / isScalarEvent(e).

/output/lib/yaml/resolver.mjs
  export function resolveScalar(value)          // -> tag string
  export function resolveSequence()             // -> TAG.seq
  export function resolveMapping()              // -> TAG.map
  Implement PyYAML's implicit resolvers, keyed by first character, tried in
  REGISTRATION ORDER (bool, float, int, merge, null, timestamp, value, yaml).
  The exact patterns are listed in /workspace/CONTRACT.md — transcribe them into
  hand-written character scanners. NO RegExp. Watch these confirmed cases:
    'true'/'yes'/'on'/'off' -> bool;  '1e5' -> str (float needs a '.' and a SIGNED exponent);
    '0o17' -> str;  '012' -> int (octal);  '0x1F' -> int;  '1_000' -> int;
    '1:2' and '12:00' -> int (sexagesimal) but '1:60' -> str;
    '.inf'/'.nan' -> float;  'nan' -> str;  '' -> null;  '=' -> value;  '<<' -> merge;
    '2024-01-15' and '2024-01-15T14:30:00Z' -> timestamp;  '~' -> null;  'y'/'n' -> str.
  Verify every one of those with the binary (a str whose text resolves to a non-str tag
  gets quoted in the output, which is directly observable).

/output/lib/yaml/representer.mjs
  export class Representer { constructor(); represent(data) -> Node }
  A fresh instance per dump. Mirror PyYAML's Representer (the UNSAFE one) exactly:
  representedObjects keyed by objectId(data) from ../pyvalues.mjs, ignoreAliases(data)
  true for PY_NONE, empty PyTuple, and any str/bytes/bool/int/float.
  Dispatch on exact type: PyNone->null 'null'; string->str; PyBytes->binary
  (base64Encodebytes from ../pyrepr.mjs, style '|'); PyBool->bool 'true'/'false';
  BigInt->int; Number->float (see CONTRACT for represent_float, including the
  ".0e" fixup and repr(...).toLowerCase()); PyList->seq; PyTuple->python/tuple;
  PyDict->map; PySet->set (as a mapping of item->null-node);
  PyFrozenSet->'tag:yaml.org,2002:python/object/apply:builtins.frozenset' with value
  [[items…]] (a seq containing one seq); PyComplex->python/complex;
  PyRange->'tag:yaml.org,2002:python/object/apply:builtins.range' with [start,stop,step];
  PyObject->'tag:yaml.org,2002:python/object:builtins.object' with an empty MappingNode.
  representMapping sorts (key,value) pairs with pySorted/pyCompare and silently keeps the
  original order if a TypeError is raised. flowStyle is always false (default_flow_style=False).
  Compute bestStyle exactly as PyYAML does even though it is then overridden — keep the code
  faithful.
  Anything unrepresentable -> PyError 'RepresenterError'.

/output/lib/yaml/serializer.mjs
  export class Serializer { constructor(emitFn); open(); serialize(node); close() }
  Faithful port of yaml.serializer.Serializer: anchors Map keyed by node object,
  ANCHOR_TEMPLATE 'id%03d' with lastAnchorId starting at 0, anchorNode() depth-first
  (mapping keys before values), serializeNode() emitting AliasEvent for already-serialized
  nodes, and implicit flags computed as described in CONTRACT.md.

/output/lib/yaml/dumper.mjs
  export function dump(data)   // -> the exact string PyYAML's yaml.dump(data) returns
  Wire it up as PyYAML does: create an Emitter writing into a string buffer, emit
  StreamStartEvent, then Serializer.open()+serialize(Representer.represent(data))
  +close(), then StreamEndEvent, and return the buffer.
  Emitter interface (written by another agent):
    import { Emitter } from './emitter.mjs'
    const chunks = []
    const emitter = new Emitter({ write: (s) => chunks.push(s) })
    emitter.emit(event)
  Note: Serializer.open() emits StreamStartEvent and close() emits StreamEndEvent in
  PyYAML; keep the event ORDER as: StreamStart, DocumentStart(explicit=false),
  <node events>, DocumentEnd(explicit=false), StreamEnd.`,
  },
  {
    key: 'emitter',
    files: '/output/lib/yaml/emitter.mjs',
    spec: `MODULE — /output/lib/yaml/emitter.mjs. This is the highest-risk file: it must be a
faithful, near-line-by-line port of PyYAML's yaml/emitter.py Emitter class, because the
task is byte-exact output matching.

Interface:
  import { Emitter } from './emitter.mjs'
  const e = new Emitter({ write: (s) => out.push(s), bestIndent: 2, bestWidth: 80,
                          allowUnicode: false, canonical: false, lineBreak: '\\n' })
  e.emit(event)
Events come from ./events.mjs (written by another agent) with these classes and fields:
  StreamStartEvent{encoding} StreamEndEvent{}
  DocumentStartEvent{explicit, version, tags} DocumentEndEvent{explicit}
  AliasEvent{anchor}
  ScalarEvent{anchor, tag, implicit, value, style}   // implicit is a 2-element array
  SequenceStartEvent{anchor, tag, implicit, flowStyle} SequenceEndEvent{}
  MappingStartEvent{anchor, tag, implicit, flowStyle} MappingEndEvent{}
Each also carries a 'kind' string ('StreamStart','StreamEnd','DocumentStart','DocumentEnd',
'Alias','Scalar','SequenceStart','SequenceEnd','MappingStart','MappingEnd'). Prefer
switching on 'kind' so you do not depend on import cycles, but you may import the classes.
If events.mjs does not exist yet, write against this documented shape anyway.

Port ALL of these, keeping PyYAML's names (camelCased) and control flow:
  the states stack + emit() dispatch loop with needMoreEvents()/needEvents()
  expectStreamStart, expectNothing, expectFirstDocumentStart, expectDocumentStart,
  expectDocumentEnd, expectDocumentRoot, expectNode, expectAlias, expectScalar,
  expectFlowSequence / expectFirstFlowSequenceItem / expectFlowSequenceItem,
  expectFlowMapping / expectFirstFlowMappingKey / expectFlowMappingKey /
  expectFlowMappingSimpleValue / expectFlowMappingValue,
  expectBlockSequence / expectFirstBlockSequenceItem / expectBlockSequenceItem,
  expectBlockMapping / expectFirstBlockMappingKey / expectBlockMappingKey /
  expectBlockMappingSimpleValue / expectBlockMappingValue,
  checkEmptySequence, checkEmptyMapping, checkEmptyDocument, checkSimpleKey,
  processAnchor, processTag, chooseScalarStyle, processScalar,
  prepareVersion, prepareTagHandle, prepareTagPrefix, prepareTag, prepareAnchor,
  analyzeScalar, flushStream,
  writeStreamStart, writeStreamEnd, writeIndicator, writeIndent, writeLineBreak,
  writeVersionDirective, writeTagDirective,
  writeSingleQuoted, writeDoubleQuoted, determineBlockHints, writeFolded, writeLiteral,
  writePlain.
State fields: states, state, events, eventQueue/event, indents, indent, flowLevel, rootContext,
sequenceContext, mappingContext, simpleKeyContext, line, column, whitespace, indention,
openEnded, analysis, style, preparedAnchor, preparedTag, tagPrefixes.

CRITICAL fidelity points (all confirmed against the reference binary):
 * DEFAULT_TAGS = { '!': '!', 'tag:yaml.org,2002:': '!!' }; tagPrefixes is reset from it
   in expectDocumentStart.
 * increaseIndent(flow, indentless): pushes current indent; if indent is null then
   indent = flow ? bestIndent : 0; else if !indentless then indent += bestIndent.
 * expectScalar does increaseIndent(flow=true) — that is why a folded ROOT scalar
   continues at column 2.
 * writePlain sets openEnded = true when rootContext. expectDocumentStart, when it sees
   StreamEndEvent and openEnded is set, writes the '...' indicator then writeIndent()
   before writeStreamEnd. Result: dump(True) === 'true\\n...\\n' while
   dump('yes') === "'yes'\\n".
 * expectBlockSequence uses indentless = (mappingContext && !indention) — block sequences
   directly under a block mapping key are NOT indented.
 * ESCAPE_REPLACEMENTS = {0x00:'0', 0x07:'a', 0x08:'b', 0x09:'t', 0x0A:'n', 0x0B:'v',
   0x0C:'f', 0x0D:'r', 0x1B:'e', '"':'"', '\\\\':'\\\\', 0x85:'N', 0xA0:'_',
   0x2028:'L', 0x2029:'P'}; else \\xHH (<=0xFF), \\uHHHH (<=0xFFFF), \\UHHHHHHHH,
   uppercase hex.
 * analyzeScalar and every write* routine must iterate CODE POINTS, not UTF-16 units.
   Use chars()/codePoints() from ../pyvalues.mjs and operate on an array of
   single-code-point strings so that indexing, len() and slicing match Python.
   Astral characters (e.g. U+1F600) must emit a single \\U0001F600 escape.
 * analyzeScalar unicode test: a character is "allowed unprintable-free" only if it is
   '\\n' or in \\x20..\\x7E; otherwise if it is 0x85, or 0xA0..0xD7FF, or 0xE000..0xFFFD,
   or 0x10000..0x10FFFE (strictly less than 0x10FFFF), and not 0xFEFF, it is a unicode
   character -> with allowUnicode false that sets specialCharacters = true; anything else
   sets specialCharacters = true too.
 * checkSimpleKey: length = len(preparedAnchor) + len(preparedTag) + len(analysis.scalar);
   returns length < 128 && (isAlias || (isScalar && !analysis.empty && !analysis.multiline)
   || checkEmptySequence() || checkEmptyMapping()).
 * writeIndent: indent = this.indent || 0; if (!indention || column > indent ||
   (column === indent && !whitespace)) writeLineBreak(); if (column < indent) { whitespace
   = true; write ' '.repeat(indent - column); column = indent; }
 * writeIndicator(indicator, needWhitespace, whitespace=false, indention=false):
   data = (this.whitespace || !needWhitespace) ? indicator : ' ' + indicator;
   this.whitespace = whitespace; this.indention = this.indention && indention;
   column += data.length; write(data).
 * writeSingleQuoted fold test: start+1 === end && column > bestWidth && split
   && start !== 0 && end !== text.length.
 * writePlain fold test: start+1 === end && column > bestWidth && split (no extra guards).
 * writeDoubleQuoted fold test: 0 < end && end < text.length - 1 &&
   (ch === ' ' || start >= end) && column + (end - start) > bestWidth && split;
   it writes text[start:end] + '\\\\', then writeIndent(), sets whitespace=false and
   indention=false, then writes an extra '\\\\' when text[start] === ' '.
 * determineBlockHints: if text non-empty: if text[0] is one of ' \\n\\x85\\u2028\\u2029'
   append String(bestIndent); if the last char is NOT a break append '-'; else if
   length===1 or the second-to-last char IS a break append '+'.
 * prepareTag percent-encodes any char outside [0-9A-Za-z] and "-;/?:@&=+$,_.~*'()[]"
   (plus '!' when handle !== '!') as UTF-8 bytes formatted '%%%02X' (uppercase).
   'tag:yaml.org,2002:python/tuple' -> '!!python/tuple'.
 * processTag for scalars: if style is null, style = chooseScalarStyle(); then if
   ((!canonical || tag === null) && ((style === '' && implicit[0]) ||
   (style !== '' && implicit[1]))) { preparedTag = null; return; }
 * chooseScalarStyle exactly as in PyYAML (plain, then '|'/'>', then single, then double).

Sanity-check your work against the binary with at least:
  'True'  "'yes'"  '[1,2,3]'  "{'b':1,'a':2}"  "(1,2)"  "{1,2}"  '[]'  '{}'  "''"
  '"a\\nb"'  '"a\\tb"'  '"h\\xe9llo "*20'  '"a "*50'  '["a "*50]'  '[["a "*50]]'
  '"aaa bbb ccc"*10'  '{"k":"word "*30}'  '[[1]]*2'  '{"k"*130:1}'  '{"":1}'
  '{(1,2):3}'  'b"x"*100'  '{"a":{"b":[{"c":(1,2)}]}}'  '"---"'
You will not be able to run the full pipeline until the other modules land; if the
integration is not ready, exercise your emitter by hand-constructing event sequences
in a scratch file under /tmp and comparing.`,
  },
]

phase('Build')
const built = await parallel(
  MODULES.map((m) => () =>
    agent(
      `${PREAMBLE}\n\nYOUR ASSIGNMENT: write ${m.files}\n\n${m.spec}\n\n` +
        `When done, reply with a terse report: the files you created, the exported names of each, ` +
        `any interface assumption you made that another module must honour, and anything you could ` +
        `not implement. Do not paste the code.`,
      { label: `build:${m.key}`, phase: 'Build', effort: 'high' }
    )
  )
)

log('Build phase complete: ' + built.filter(Boolean).length + '/' + MODULES.length + ' module groups reported')

phase('Integrate')
const integration = await agent(
  `${PREAMBLE}

The library modules under /output/lib have just been written by five separate agents.
Reports from those agents:

${MODULES.map((m, i) => `--- ${m.key} ---\n${built[i] || '(agent produced no report)'}`).join('\n\n')}

YOUR ASSIGNMENT:
1. Write /output/test2.mjs — the entry point. It must behave exactly like the Python:
     import { parseArgs } from './lib/argparse.mjs'
     import { pyEval } from './lib/python/evaluator.mjs'
     import { dump } from './lib/yaml/dumper.mjs'
     const args = parseArgs(process.argv.slice(2))
     const result = dump(pyEval(args.a))
     process.stdout.write(result + '\\n')          // print() adds one newline
   Wrap the eval+dump in a handler that, on a PyError, prints the CPython-style traceback
   to stderr and exits 1:
     Traceback (most recent call last):
       File "test2.py", line 8, in <module>
       File "<string>", line 1, in <module>
     NameError: name 'foo' is not defined
     [PYI-<pid>:ERROR] Failed to execute script 'test2' due to unhandled exception!
   For SyntaxError the third line is '  File "<string>", line <lineno>' with no
   ', in <module>', followed by a line with the source indented by 4 spaces, and then
   (when an offset is known) a caret line of '^' characters, then
   'SyntaxError: invalid syntax'. Empty source uses lineno 0 and an empty source line.
   Verify the shape against: /workspace/dataset/test2_executable --a 'foo' ; --a '1+' ;
   --a 'x=1' ; --a '' ; --a '1/0'  (the PYI number is the pid and cannot be matched).
   Use 'node:process'. Nothing may be written to stdout on the error path.

2. Make the whole thing actually run. Resolve every interface mismatch between the five
   module groups: missing/renamed exports, wrong argument shapes, import cycles, syntax
   errors. You may edit any file under /output except /output/lib/pyvalues.mjs.
   Iterate until 'node /output/test2.mjs --a "[1,2,3]"' works.

3. Then run the smoke corpus and fix everything that differs:
     /workspace/probe/diff.sh /workspace/probe/cases1.txt
     /workspace/probe/diff.sh /workspace/probe/cases2.txt
     /workspace/probe/diff.sh /workspace/probe/cases3.txt
     /workspace/probe/diff.sh /workspace/probe/cases4.txt
     /workspace/probe/diff.sh /workspace/probe/cases5.txt
     /workspace/probe/diff.sh /workspace/probe/cases6.txt
   (each prints only mismatches plus a tally). Keep fixing until the tallies are as close
   to zero as you can get them. Also verify the argparse rows in CONTRACT.md by hand,
   comparing 'node /output/test2.mjs <argv>' with the binary, including exit codes.

4. Audit for rule violations: grep the tree for 'require(', 'module.exports', the JSON
   identifier, 'new RegExp', and regex literals; confirm every import is relative with a
   .mjs suffix and no npm package is imported.

Report: the final mismatch tally per corpus, every file you changed, and any remaining
known-broken area.`,
  { label: 'integrate', phase: 'Integrate', effort: 'high' }
)

log('Integration done')

return { built, integration }
