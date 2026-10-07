export const meta = {
  name: 'jinja2-spec-audit',
  description: 'Audit /workspace Jinja2 implementation against the project specification and verify integration',
  phases: [
    { title: 'Audit', detail: 'one agent per module/spec-slice, verify named entities exist and behave' },
    { title: 'Verify', detail: 'adversarially re-check each reported gap' },
    { title: 'Integration', detail: 'clean install, test-suite modes, examples, typing' },
  ],
}

const COMMON = `
You are auditing a Python project at /workspace that must implement the Jinja2 template engine
(target version 3.2.0.dev, Python 3.10). The package source is at /workspace/src/jinja2 and it is
already pip-installed in editable mode (\`import jinja2\` works from any cwd).
The official test suite lives at /workspace/tests (identical copy also at /jinja/tests).

RULES:
- READ-ONLY on /workspace. Do NOT edit, create, or delete any file under /workspace.
  Use /tmp for any scratch files you need.
- Verify claims by ACTUALLY RUNNING python (e.g. \`python3 -c "..."\`, \`python3 -c "import inspect; ..."\`)
  and by reading the source. Do not guess.
- A "gap" means: a named entity the specification requires is MISSING, has a WRONG signature
  (different parameter names/order/defaults), or demonstrably misbehaves.
  Naming/typing style differences are NOT gaps. Private helpers being private is NOT a gap.
- Note: this is Jinja 3.2.0.dev. Aliases removed upstream long ago (e.g. \`contextfilter\`,
  \`evalcontextfilter\`, \`contextfunction\`) are intentionally absent — report them at most as severity "info".
`

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slice', 'checked_count', 'gaps', 'notes'],
  properties: {
    slice: { type: 'string' },
    checked_count: { type: 'integer' },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entity', 'severity', 'problem', 'evidence'],
        properties: {
          entity: { type: 'string', description: 'e.g. jinja2.filters.do_items' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'exact command run + output proving it' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'reason', 'suggested_fix'],
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
    suggested_fix: { type: 'string' },
  },
}

const SLICES = [
  {
    key: 'init-exports',
    prompt: `Audit /workspace/src/jinja2/__init__.py and the top-level import surface.
The spec requires that this statement works:
\`\`\`
from jinja2 import (
    Environment, Template, Undefined, StrictUndefined, DebugUndefined,
    ChainableUndefined, make_logging_undefined, select_autoescape,
    clear_caches, is_undefined, pass_context, pass_environment,
    pass_eval_context, TemplateError, TemplateNotFound, TemplatesNotFound,
    TemplateSyntaxError, TemplateRuntimeError, TemplateAssertionError,
    UndefinedError, BytecodeCache, FileSystemBytecodeCache,
    MemcachedBytecodeCache, BaseLoader, FileSystemLoader, PackageLoader,
    DictLoader, FunctionLoader, ChoiceLoader, PrefixLoader, ModuleLoader
)
\`\`\`
Spec examples elsewhere also do: \`from jinja2 import Environment, Context\`,
\`from jinja2 import Environment, optimize\`, \`from jinja2 import NativeEnvironment, NativeTemplate\`,
\`from jinja2 import SandboxedEnvironment\`, \`from jinja2 import constants\`, \`from jinja2 import Environment, meta\`,
\`from jinja2 import Environment, Extension, nodes\`, \`from jinja2.ext import i18n\`,
\`from jinja2.visitor import NodeVisitor, NodeTransformer\`, \`from jinja2.idtracking import find_symbols, symbols_for_node\`,
\`from jinja2.async_utils import async_variant, auto_await, auto_aiter\`.
Run every one of those imports. Also confirm version info is available
(importlib.metadata.version("jinja2") and the deprecated jinja2.__version__ shim).
Also confirm that a bogus attribute still raises AttributeError, and that \`import jinja2\` emits no warnings
(run with -W error).`,
  },
  {
    key: 'environment',
    prompt: `Audit /workspace/src/jinja2/environment.py.
Verify the \`Environment\` class __init__ signature EXACTLY matches the spec order and defaults:
block_start_string='{%', block_end_string='%}', variable_start_string='{{', variable_end_string='}}',
comment_start_string='{#', comment_end_string='#}', line_statement_prefix=None, line_comment_prefix=None,
trim_blocks=False, lstrip_blocks=False, newline_sequence='\\n', keep_trailing_newline=False,
extensions=(), optimized=True, undefined=Undefined, finalize=None, autoescape=False, loader=None,
cache_size=400, auto_reload=True, bytecode_cache=None, enable_async=False.
Use inspect.signature to prove it.
Also verify these exist and work: Environment.overlay, .lex, .preprocess, .parse, .compile, .compile_expression,
.compile_templates, .from_string, .get_template, .select_template, .get_or_select_template, .join_path,
.list_templates, .add_extension, .extend, .iter_extensions, .getattr, .getitem, .call_filter, .call_test,
.handle_exception, .policies, .globals, .filters, .tests, .shared, .sandboxed, .is_async, .concat.
Verify Template: .render, .render_async, .stream, .generate, .generate_async, .new_context, .make_module,
.make_module_async, ._get_default_module, .module, .debug_info, .from_code, .from_module_dict, .root_render_func.
Verify TemplateStream (dump, disable_buffering, enable_buffering), TemplateModule, TemplateExpression,
get_spontaneous_environment, create_cache, copy_cache, load_extensions, _environment_config_check.
Actually construct and render templates to prove behavior.`,
  },
  {
    key: 'lexer',
    prompt: `Audit /workspace/src/jinja2/lexer.py.
Verify class \`Lexer\` exists with tokenize/tokeniter/wrap. Verify Token, TokenStream, TokenStreamIterator,
Failure, OptionalLStrip, _Rule, get_lexer, compile_rules, count_newlines, describe_token,
describe_token_expr, _describe_token_type, newline_re, operators, reverse_operators, ignore_if_empty.
Verify EVERY TOKEN_* constant listed in the spec exists (TOKEN_ADD, TOKEN_ASSIGN, TOKEN_COLON, TOKEN_COMMA,
TOKEN_DIV, TOKEN_DOT, TOKEN_EQ, TOKEN_FLOORDIV, TOKEN_GT, TOKEN_GTEQ, TOKEN_LBRACE, TOKEN_LBRACKET,
TOKEN_LPAREN, TOKEN_LT, TOKEN_LTEQ, TOKEN_MOD, TOKEN_MUL, TOKEN_NE, TOKEN_PIPE, TOKEN_POW, TOKEN_RBRACE,
TOKEN_RBRACKET, TOKEN_RPAREN, TOKEN_SEMICOLON, TOKEN_SUB, TOKEN_TILDE, TOKEN_WHITESPACE, TOKEN_FLOAT,
TOKEN_INTEGER, TOKEN_NAME, TOKEN_STRING, TOKEN_OPERATOR, TOKEN_BLOCK_BEGIN, TOKEN_BLOCK_END,
TOKEN_VARIABLE_BEGIN, TOKEN_VARIABLE_END, TOKEN_RAW_BEGIN, TOKEN_RAW_END, TOKEN_COMMENT_BEGIN,
TOKEN_COMMENT_END, TOKEN_COMMENT, TOKEN_LINESTATEMENT_BEGIN, TOKEN_LINESTATEMENT_END,
TOKEN_LINECOMMENT_BEGIN, TOKEN_LINECOMMENT_END, TOKEN_LINECOMMENT, TOKEN_DATA, TOKEN_INITIAL, TOKEN_EOF)
and that each equals the interned string given in the spec.
Behaviorally verify the spec's Node 1 example: env.lex("Hello {{ name }}! {% for item in items %}{{ item }}{% endfor %}")
yields tokens with .type/.value/.lineno, and that "{{ 1 + 2 }}" produces variable_begin and variable_end tokens.
Verify custom delimiters, line_statement_prefix, line_comment_prefix, trim_blocks, lstrip_blocks, keep_trailing_newline.`,
  },
  {
    key: 'parser-nodes',
    prompt: `Audit /workspace/src/jinja2/parser.py and /workspace/src/jinja2/nodes.py.
parser.py: class \`Parser\` with parse, parse_statements, parse_expression, parse_tuple, parse_assign_target,
subparse, free_identifier, fail, fail_unknown_tag, fail_eof, and the module constants
_statement_keywords, _compare_operators, _math_nodes, _ImportInclude, _MacroCall.
nodes.py: verify NodeType metaclass, Node, Stmt, Helper, Expr, Literal, BinExpr, UnaryExpr, and every node
class named in the spec: Template, Output, Extends, ExprStmt, For, If, Macro, CallBlock, FilterBlock, With,
Block, Include, Import, FromImport, Assign, AssignBlock, Scope, OverlayScope, EvalContextModifier,
ScopedEvalContextModifier, Const, TemplateData, Tuple, List, Dict, Pair, Keyword, CondExpr, Filter, Test,
Call, Getitem, Getattr, Slice, Concat, Compare, Operand, Add, Sub, Mul, Div, FloorDiv, Mod, Pow, And, Or,
Not, Neg, Pos, EnvironmentAttribute, ExtensionAttribute, ImportedName, InternalName, MarkSafe,
MarkSafeIfAutoescape, ContextReference, DerivedContextReference, Continue, Break, NSRef.
Verify module-level: _NodeBound, _binop_to_func, _uaop_to_func, _cmpop_to_func, _failing_new,
args_as_const, get_eval_context, EvalContext, Impossible.
Verify InternalName() raises TypeError("can't create internal names...") and that creating a custom Node
subclass at runtime via the public API raises TypeError("can't create custom node types") where the spec says so.
Verify as_const on BinExpr/UnaryExpr/CondExpr/Concat/Compare/Getitem/Getattr/Slice/Pair/TemplateData/MarkSafe/
MarkSafeIfAutoescape works and raises Impossible where appropriate.
Verify node.iter_child_nodes(), find(), find_all(), set_lineno(), set_environment(), __eq__, __repr__, dump().
Run the spec's Node 2 example (parse an if/else template and walk iter_child_nodes recursively).`,
  },
  {
    key: 'compiler-idtracking',
    prompt: `Audit /workspace/src/jinja2/compiler.py and /workspace/src/jinja2/idtracking.py.
compiler.py: class \`CodeGenerator\` plus Frame, MacroRef, VisitorExit, UndeclaredNameVisitor,
DependencyFinderVisitor, CompilerExit, CodeGenerator._FinalizeInfo, generate(), has_safe_repr(),
find_undeclared(), optimizeconst(), _make_binop(), _make_unop(), operators dict.
Verify Frame has: eval_ctx, parent, symbols, require_output_check, buffer, block, toplevel, rootlevel,
loop_frame, block_frame, soft_frame, copy(), inner(isolated=False), soft(), __copy__.
Verify MacroRef fields node/accesses_caller/accesses_kwargs/accesses_varargs.
Verify DependencyFinderVisitor collects .filters and .tests and stops at Block.
Verify UndeclaredNameVisitor(names) sets .undeclared and stops at Block; VisitorExit is a RuntimeError.
idtracking.py: Symbols (level, parent, refs, loads, stores, analyze_node, _define_ref, find_load, find_ref,
ref, copy, store, declare_parameter, load, branch_update, dump_stores, dump_param_targets),
RootVisitor, FrameSymbolVisitor (visit_Name, visit_NSRef, visit_If, visit_Macro, visit_Import,
visit_FromImport, visit_Assign, visit_For, visit_CallBlock, visit_FilterBlock, visit_With,
visit_AssignBlock, visit_Scope, visit_Block, visit_OverlayScope), find_symbols, symbols_for_node,
and constants VAR_LOAD_PARAMETER="param", VAR_LOAD_RESOLVE="resolve", VAR_LOAD_ALIAS="alias",
VAR_LOAD_UNDEFINED="undefined".
Run the spec Node 3 and Node 21 examples: env.compile(source) returns code that exec()s; and
symbols_for_node(env.parse("{% set x = 1 %}{{ x }}")).stores contains 'x'.`,
  },
  {
    key: 'runtime',
    prompt: `Audit /workspace/src/jinja2/runtime.py.
Verify: Context (with resolve, resolve_or_missing, get_all, get_exported, call, derived, super,
get, keys/values/items via _dict_method_all, environment, parent, vars, name, blocks, eval_ctx, exported_vars),
TemplateReference, BlockReference (name, super, __call__, _async_call), LoopContext (index0, index, length,
__len__, depth0, depth, revindex, revindex0, first, last, previtem, nextitem, cycle, changed, _peek_next,
_to_iterator, __iter__, __next__, __call__, __repr__), AsyncLoopContext, Macro, Undefined, ChainableUndefined,
DebugUndefined, StrictUndefined, make_logging_undefined, Namespace, new_context, markup_join, str_join,
_dict_method_all, missing, exported, async_exported, identity, concat, V/F typevars as applicable.
Verify Undefined.__init__(hint=None, obj=missing, name=None, exc=UndefinedError) signature.
Verify Undefined semantics: str()=="" , len()==0, iteration yields nothing, bool False, comparisons,
_fail_with_undefined_error on arithmetic; StrictUndefined raises on str/len/iter/bool/eq;
DebugUndefined str() returns "{{ name }}"; ChainableUndefined supports attribute/item chaining.
Verify make_logging_undefined(logger=None, base=Undefined) logs.
Run the spec Node 4 example: Context(env, {...}) construction — report the ACTUAL public constructor
signature of Context and whether \`Context(env, {'name': 'World'})\` as written in the spec works or errors.`,
  },
  {
    key: 'filters',
    prompt: `Audit /workspace/src/jinja2/filters.py.
Verify EVERY filter named in the spec exists in the FILTERS dict AND as a module-level function:
abs, attr, batch, capitalize, center, count, d, default, dictsort, e, escape, filesizeformat, first, float,
forceescape, format, groupby, indent, int, items, join, last, length, list, lower, map, max, min, pprint,
random, reject, rejectattr, replace, reverse, round, safe, select, selectattr, slice, sort, string,
striptags, sum, title, tojson, trim, truncate, unique, upper, urlencode, urlize, wordcount, wordwrap, xmlattr.
Verify the spec-named implementation functions: do_forceescape, do_urlencode, do_replace, do_upper, do_lower,
do_items, do_xmlattr, do_capitalize, do_title, do_dictsort, do_sort, sync_do_unique, do_unique, _min_or_max,
do_min, do_max, do_default, do_center, sync_do_first, do_first, do_last, do_random, sync_do_join, do_join,
do_filesizeformat, do_pprint, do_urlize, do_indent, do_truncate, do_wordwrap, do_wordcount, do_int, do_float,
do_format, do_trim, do_striptags, sync_do_slice, do_slice, do_batch, do_round, sync_do_groupby, do_groupby,
sync_do_sum, do_sum, sync_do_list, do_list, do_mark_safe, do_mark_unsafe, do_reverse, do_attr, sync_do_map,
do_map, sync_do_select, do_select, sync_do_selectattr, do_selectattr, sync_do_reject, do_reject,
sync_do_rejectattr, do_rejectattr, do_tojson, prepare_map, prepare_select_or_reject, select_or_reject,
async_select_or_reject, ignore_case, make_attrgetter, make_multi_attrgetter, _prepare_attribute_parts,
_GroupTuple, FilterArgumentError (importable from jinja2.filters or jinja2.exceptions), _attr_key_re,
_uri_scheme_re, _word_re, _word_beginning_split_re.
Check signatures against the spec (e.g. do_dictsort(value, case_sensitive=False, by="key", reverse=False),
do_round(value, precision=0, method="common"), do_truncate(env, s, length=255, killwords=False, end="...",
leeway=None), do_indent(s, width=4, first=False, blank=False), do_int(value, default=0, base=10),
do_filesizeformat(value, binary=False), do_urlize(...), do_wordwrap(...)).
Behaviorally exercise at least 25 filters including the spec's Node 5 examples.`,
  },
  {
    key: 'tests-defaults-constants',
    prompt: `Audit /workspace/src/jinja2/tests.py, defaults.py, constants.py, exceptions.py, visitor.py, optimizer.py, meta.py.
tests.py: verify TESTS dict and functions for defined, undefined, none, number, string, sequence, mapping,
callable, sameas, equalto/eq/==, ne/!=, lt/</lessthan, le/<=, gt/>/greaterthan, ge/>=, even, odd,
divisibleby, escaped, upper, lower, boolean, false, true, integer, float, in, filter, test, iterable.
Exercise each one.
defaults.py: BLOCK_START_STRING, BLOCK_END_STRING, VARIABLE_START_STRING, VARIABLE_END_STRING,
COMMENT_START_STRING, COMMENT_END_STRING, LINE_STATEMENT_PREFIX, LINE_COMMENT_PREFIX, TRIM_BLOCKS,
LSTRIP_BLOCKS, NEWLINE_SEQUENCE, KEEP_TRAILING_NEWLINE, DEFAULT_NAMESPACE (must contain range, dict, lipsum,
cycler, joiner, namespace), DEFAULT_POLICIES (must contain compiler.ascii_str, urlize.rel, urlize.target,
urlize.extra_schemes, truncate.leeway, json.dumps_function, json.dumps_kwargs, ext.i18n.trimmed),
DEFAULT_FILTERS, DEFAULT_TESTS. Check exact values against the spec.
constants.py: LOREM_IPSUM_WORDS non-empty; the spec asserts 'lorem' in LOREM_IPSUM_WORDS.lower() — CHECK THIS
and report the actual truth.
exceptions.py: TemplateError, TemplateNotFound (IOError+LookupError+TemplateError), TemplatesNotFound,
TemplateSyntaxError, TemplateAssertionError, TemplateRuntimeError, UndefinedError, SecurityError,
FilterArgumentError — verify MRO and __init__ signatures per spec.
visitor.py: NodeVisitor (visit, generic_visit, get_visitor) and NodeTransformer (visit_list, generic_visit).
Run the spec Node 18 example (custom NodeVisitor counting Name nodes on "{{ x + y }}" must give 2;
NodeTransformer uppercasing Const strings).
optimizer.py: Optimizer class + optimize(node, environment). Run the Node 17 example.
meta.py: find_undeclared_variables, find_referenced_templates, TrackingCodeGenerator, _ref_types, _RefType.
Run the Node 19 examples and report the exact outputs.`,
  },
  {
    key: 'loaders-bccache',
    prompt: `Audit /workspace/src/jinja2/loaders.py and /workspace/src/jinja2/bccache.py.
loaders.py: BaseLoader (get_source, list_templates, load, has_source_access), FileSystemLoader(searchpath,
encoding="utf-8", followlinks=False), PackageLoader(package_name, package_path="templates",
encoding="utf-8"), DictLoader(mapping), FunctionLoader(load_func), PrefixLoader(mapping, delimiter="/"),
ChoiceLoader(loaders), ModuleLoader(path), _TemplateModule, split_template_path.
Verify each signature with inspect.signature and each loader end-to-end with a real template
(create scratch dirs/packages under /tmp only).
bccache.py: Bucket (key, checksum, environment, reset, load_bytecode, write_bytecode, bytecode_from_string,
bytecode_to_string), BytecodeCache (load_bytecode, dump_bytecode, clear, get_cache_key, get_source_checksum,
get_bucket, set_bucket), FileSystemBytecodeCache(directory=None, pattern="__jinja2_%s.cache"),
MemcachedBytecodeCache(client, prefix="jinja2/bytecode/", timeout=None, ignore_memcache_errors=True),
bc_version, bc_magic.
Run the spec Node 8 example end-to-end: FileSystemBytecodeCache in a tempdir, render "{{ x + y }}" with
x=1,y=2 => "3", and assert a cache file is created. Report exactly what happens.`,
  },
  {
    key: 'sandbox-security',
    prompt: `Audit /workspace/src/jinja2/sandbox.py.
Verify SandboxedEnvironment (sandboxed=True, default_binop_table, default_unop_table, intercepted_binops,
intercepted_unops, binop_table, unop_table, is_safe_attribute, is_safe_callable, call_binop, call_unop,
getitem, getattr, unsafe_undefined, wrap_str_format, call, format_string), ImmutableSandboxedEnvironment,
SandboxedFormatter, SandboxedEscapeFormatter, SecurityError, safe_range, unsafe, is_internal_attribute,
modifies_known_mutable, inspect_format_method, MAX_RANGE=100000, UNSAFE_FUNCTION_ATTRIBUTES (empty set),
UNSAFE_METHOD_ATTRIBUTES (empty set), UNSAFE_GENERATOR_ATTRIBUTES={"gi_frame","gi_code"},
UNSAFE_COROUTINE_ATTRIBUTES={"cr_frame","cr_code"}, UNSAFE_ASYNC_GENERATOR_ATTRIBUTES={"ag_code","ag_frame"},
_mutable_spec.
Then run real SECURITY tests: confirm the sandbox blocks access to __class__, __subclasses__, __globals__,
__mro__, func_globals, __builtins__; confirm \`{{ "".__class__ }}\` and the classic
\`{{ "".__class__.__mro__[1].__subclasses__() }}\` escape are blocked; confirm str.format /
str.format_map sandboxing (the CVE-2016-10745 style \`{{ "{0.__class__}".format(x) }}\` escape);
confirm range() is capped at MAX_RANGE; confirm ImmutableSandboxedEnvironment blocks list.append,
dict.clear, set.add, deque.rotate; confirm intercepted_binops/intercepted_unops actually route through
call_binop/call_unop. Report anything that is NOT blocked as a blocker.`,
  },
  {
    key: 'async-ext-debug-native',
    prompt: `Audit /workspace/src/jinja2/async_utils.py, ext.py, debug.py, nativetypes.py.
async_utils.py: async_variant, auto_await, auto_aiter, auto_to_list, _IteratorToAsyncIterator,
_common_primitives = {int, float, bool, str, list, dict, tuple, type(None)}.
Verify enable_async rendering end-to-end under BOTH asyncio and trio: async filters, async generators as
loop iterables, async macro calls, render_async, generate_async, and that sync API still works.
ext.py: Extension (identifier, tags, priority, bind, preprocess, filter_stream, parse, attr, call_method),
InternationalizationExtension (+ alias i18n), ExprStmtExtension (+ alias do), LoopControlExtension
(+ alias loopcontrols), DebugExtension (+ alias debug), _CommentFinder, extract_from_ast, babel_extract,
_make_new_gettext, _make_new_ngettext, _make_new_pgettext, _make_new_npgettext, _gettext_alias,
GETTEXT_FUNCTIONS, _ws_re.
Exercise: {% trans %}/{% pluralize %}, install_gettext_translations/install_null_translations/
install_gettext_callables/uninstall_gettext_translations/extract_translations, newstyle gettext,
pgettext/npgettext contexts, {% do %}, {% break %}/{% continue %}, {% debug %}.
Babel 2.17 is installed — actually run babel_extract on a template.
debug.py: rewrite_traceback_stack, fake_traceback, get_template_locals. Prove a runtime error inside a
template produces a traceback frame pointing at the template filename and correct line number.
nativetypes.py: NativeEnvironment, NativeTemplate, NativeCodeGenerator, native_concat. Run every spec Node 20
example and report the exact type+value of each result.`,
  },
  {
    key: 'utils-packaging',
    prompt: `Audit /workspace/src/jinja2/utils.py plus the repository's packaging and supporting files.
utils.py: missing, _MissingType, internalcode, consume, clear_caches, import_string, open_if_exists,
object_type_repr, pformat, urlize, generate_lorem_ipsum, url_quote, unicode_urlencode (if present),
htmlsafe_json_dumps, LRUCache (capacity, _mapping, _queue, _postinit, __getstate__, __setstate__,
__getnewargs__, copy/__copy__, get, setdefault, clear, __contains__, __len__, __repr__, __getitem__,
__setitem__, __delitem__, items, values, keys, __iter__, __reversed__), select_autoescape, Cycler
(items, pos, reset, current, next, __next__), Joiner(sep=", "), Namespace, F/V typevars, _PassArg
(context/eval_context/environment enum members + from_obj), pass_context, pass_environment,
pass_eval_context, is_undefined, concat, _entity_re / _http_re / _email_re as applicable.
Verify LRUCache is registered as a MutableMapping and is picklable/copyable.
Verify Cycler raises RuntimeError("at least one item has to be provided") when constructed empty.
Repository files: confirm /workspace has pyproject.toml (name Jinja2, requires-python >=3.10,
dependencies MarkupSafe>=3.0, i18n extra Babel>=2.17, dependency-groups with ruff/tox/tox-uv/pytest/
pytest-timeout/trio/mypy/pyright/sphinx/pallets-sphinx-themes/sphinxcontrib-log-cabinet, a build-system,
and the tool.pytest/tool.mypy/tool.ruff config), README.md, LICENSE.txt, CHANGES.rst, uv.lock,
src/jinja2/py.typed, scripts/generate_identifier_pattern.py, docs/ (api.rst, templates.rst, extensions.rst,
sandbox.rst, nativetypes.rst, conf.py, examples/cache_extension.py, examples/inline_gettext_extension.py,
_static/jinja-icon.svg, _static/jinja-logo.svg, _static/jinja-name.svg), examples/basic/ (cycle.py,
debugger.py, inheritance.py, test.py, test_filter_and_linestatements.py, test_loop_filter.py, translate.py,
templates/broken.html, templates/subbroken.html), .devcontainer/, .editorconfig, .gitignore,
.pre-commit-config.yaml, .readthedocs.yaml.
Also verify _identifier.py exports the \`pattern\` regex string and that
scripts/generate_identifier_pattern.py has get_characters/collapse_ranges/build_pattern and RUNS
(execute it and confirm the pattern it prints matches src/jinja2/_identifier.py).
Report any file listed in the spec's directory tree that is missing.`,
  },
  {
    key: 'behavioral-nodes',
    prompt: `Behaviorally validate the specification's 25 "Detailed Implementation Nodes" end to end.
For each of the following, write a scratch script under /tmp and RUN it, then report the exact output:
Node 1 Lexer, Node 2 Parser, Node 3 Code Generator, Node 4 Runtime, Node 5 Filters, Node 6 Tests,
Node 7 Loaders (FileSystemLoader/DictLoader/FunctionLoader/PackageLoader/ChoiceLoader/PrefixLoader/
ModuleLoader), Node 8 BytecodeCache, Node 9 Sandbox, Node 10 Async, Node 11 Inheritance (multi-level,
{{ super() }}, nested blocks, scoped/required blocks), Node 12 Macros (defaults, varargs, kwargs, caller,
{% call %}), Node 13 Include (with/without context, ignore missing, list of names), Node 14 Import
({% import as %}, {% from import %}, with/without context), Node 15 Extensions (custom filter extension and
a custom {% cache %} tag extension built with parser.parse_statements + nodes.CallBlock + self.call_method),
Node 16 Debug (DebugUndefined, error location), Node 17 Optimizer, Node 18 Visitor, Node 19 Meta,
Node 20 NativeTypes, Node 21 IDTracking, Node 22 AsyncUtils, Node 23 Defaults, Node 24 Constants,
Node 25 I18n.
Also validate the "Supported Expression Types" list: variable access, attribute access, subscript,
function call, filter chain, test expression, math, comparison + and/or, conditional expression, slices,
list/dict/tuple literals, string concat with ~, line statements, whitespace control, {% raw %}, {% set %}
blocks, {% with %}, {% filter %}, namespaces, loop.cycle/changed/previtem/nextitem/depth, recursive loops,
loop filtering (\`for x in y if cond\`), autoescape + |safe + |escape, select_autoescape.
Report anything that errors or produces a result contradicting the spec. Note where the SPEC ITSELF is
wrong (e.g. its own example output is inconsistent with real Jinja2 semantics) — mark those severity "info".`,
  },
]

phase('Audit')

const results = await pipeline(
  SLICES,
  (s) => agent(COMMON + '\n\nAUDIT SLICE: ' + s.key + '\n' + s.prompt, {
    label: `audit:${s.key}`,
    phase: 'Audit',
    schema: AUDIT_SCHEMA,
  }),
  (res, s) => {
    if (!res || !res.gaps || res.gaps.length === 0) return { slice: s.key, verified: [] }
    const actionable = res.gaps.filter((g) => g.severity !== 'info')
    if (actionable.length === 0) return { slice: s.key, verified: res.gaps.map((g) => ({ ...g, real: false, reason: 'info-only, not verified' })) }
    return parallel(actionable.map((g) => () =>
      agent(COMMON + `
Another agent claims this is a defect in the /workspace Jinja2 implementation. Your job is to REFUTE it.
Default to refuted unless you can reproduce the problem yourself with a command you run.

ENTITY: ${g.entity}
CLAIMED PROBLEM: ${g.problem}
CLAIMED EVIDENCE: ${g.evidence}

Reproduce it. Consider: is this actually correct behavior for Jinja 3.2.0.dev? Does the official test suite
at /workspace/tests already cover and accept this behavior? Is the specification text simply describing
upstream Jinja inaccurately? If the claim does not hold, set real=false.
If it DOES hold, set real=true and give a concrete minimal fix (file + what to change).`, {
        label: `verify:${g.entity}`,
        phase: 'Verify',
        schema: VERDICT_SCHEMA,
      }).then((v) => ({ ...g, real: v ? v.real : null, reason: v ? v.reason : 'verifier died', suggested_fix: v ? v.suggested_fix : '' }))
    )).then((verified) => ({ slice: s.key, verified, info: res.gaps.filter((g) => g.severity === 'info') }))
  }
)

phase('Integration')

const INTEGRATION = [
  {
    key: 'clean-install',
    prompt: `Validate that /workspace is a properly installable package.
1. Build a wheel and an sdist from /workspace into /tmp/dist (use \`python3 -m pip wheel --no-deps\` or
   \`python3 -m build\` if available; install build backends into a scratch venv, not the system env).
2. Create a FRESH virtualenv in /tmp (python3 -m venv), pip install the built wheel into it, and from a
   directory that is NOT /workspace run a script that imports jinja2 and renders templates, uses
   FileSystemLoader, PackageLoader, the sandbox, async rendering, and the i18n extension.
3. Confirm py.typed ships inside the wheel and that the wheel contains all 24 modules of the package.
4. Run the full official test suite (/workspace/tests) inside that fresh venv against the INSTALLED package
   (install pytest, pytest-timeout, trio there). Report pass/fail counts.
5. Confirm the sdist contains src/, tests/, docs/, examples/, CHANGES.rst, LICENSE.txt, README.md.
Do NOT modify anything under /workspace. Report exact commands and outputs.`,
  },
  {
    key: 'test-modes',
    prompt: `Run the official test suite in many modes and report exact pass/fail/error counts for each.
Use the system python (jinja2 is installed editable from /workspace/src).
a) \`cd /workspace && python3 -m pytest -q\`
b) \`cd /workspace && python3 -m pytest tests -q -W error\`
c) \`cd /jinja && python3 -m pytest -q\` (the grader's copy of the tests)
d) \`python3 -m pytest /workspace/tests -q -p no:cacheprovider\` from /tmp
e) run each test file individually and report any file that fails in isolation
f) \`python3 -m pytest /workspace/tests -q --timeout=60\`
g) run the suite twice in the same session / re-run to check for state leakage between tests
h) if pytest-xdist is available run with -n 4; if not, skip and say so.
Report ANY failure, error, warning-turned-error, or skipped test, with the test id and the reason.
Also list how many tests are skipped and why (e.g. optional deps).
Do NOT modify anything under /workspace.`,
  },
  {
    key: 'examples-docs-typing',
    prompt: `Three checks. Do NOT modify anything under /workspace; copy to /tmp if a script needs to write.
1. EXAMPLES: run every script in /workspace/examples/basic/ (cycle.py, debugger.py, inheritance.py, test.py,
   test_filter_and_linestatements.py, test_loop_filter.py, translate.py) and both scripts in
   /workspace/docs/examples/. Report which run cleanly and which fail (some may be interactive or expect
   a traceback — say so explicitly and quote the output).
2. TYPING: run \`python3 -m mypy\` (config is in /workspace/pyproject.toml, strict, files=["src"]) from
   /workspace, and \`python3 -m pyright\` if it works offline. Report error counts and the first 20 errors.
   Also run \`ruff check .\` and \`ruff format --check .\` from /workspace.
3. DOCS: attempt \`python3 -m sphinx -b dirhtml docs /tmp/docsbuild\` from /workspace (sphinx,
   pallets-sphinx-themes and sphinxcontrib-log-cabinet are installed). Report whether it builds and any
   warnings/errors. If it needs network, note that.`,
  },
]

const integration = await parallel(INTEGRATION.map((i) => () =>
  agent(COMMON + '\n\nINTEGRATION CHECK: ' + i.key + '\n' + i.prompt, {
    label: `integration:${i.key}`,
    phase: 'Integration',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['check', 'passed', 'summary', 'problems'],
      properties: {
        check: { type: 'string' },
        passed: { type: 'boolean' },
        summary: { type: 'string' },
        problems: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['what', 'severity', 'detail'],
            properties: {
              what: { type: 'string' },
              severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
              detail: { type: 'string' },
            },
          },
        },
      },
    },
  })
))

const confirmed = results
  .filter(Boolean)
  .flatMap((r) => (r.verified || []).filter((v) => v.real === true))

log(`audit complete: ${confirmed.length} confirmed gaps`)

return {
  confirmed_gaps: confirmed,
  info_notes: results.filter(Boolean).flatMap((r) => r.info || []),
  integration: integration.filter(Boolean),
}
