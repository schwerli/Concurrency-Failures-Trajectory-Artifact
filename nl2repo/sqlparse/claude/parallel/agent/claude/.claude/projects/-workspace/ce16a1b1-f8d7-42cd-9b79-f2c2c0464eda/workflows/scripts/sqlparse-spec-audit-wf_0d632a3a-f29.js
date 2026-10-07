export const meta = {
  name: 'sqlparse-spec-audit',
  description: 'Audit the /workspace sqlparse implementation against every API claim in the project spec',
  phases: [
    { title: 'Audit', detail: 'one read-only agent per spec API dimension' },
    { title: 'Verify', detail: 'independently confirm each reported gap is real' },
    { title: 'Synthesize', detail: 'prioritized patch list' },
  ],
}

const COMMON = `
You are auditing a Python implementation of the \`sqlparse\` library located at /workspace.
It is installed (editable) so \`import sqlparse\` works from any cwd. Python is python3 (3.10).

RULES:
- READ-ONLY. Do NOT edit, create, or delete any file in /workspace. Report only.
- VERIFY EMPIRICALLY. For every claim, actually run python3 (e.g.
  \`python3 -c "import sqlparse; ..."\`) or read the source. Never guess.
- The authoritative correctness bar is /workspace/tests/ (the upstream test suite,
  477 tests, currently all passing). A "gap" that would require changing behavior
  pinned by those tests is NOT actionable - flag it as spec-fiction instead.
- Distinguish two finding kinds:
  (a) MISSING SYMBOL: a name/class/method/constant the spec says must exist but which
      raises ImportError/AttributeError. These are actionable (adding them is additive
      and safe).
  (b) BEHAVIORAL MISMATCH: a documented input->output example that does not reproduce.
      For each, check whether /workspace/tests/ pins the current behavior
      (grep the tests). If pinned, say so - we must NOT change it.
- Be exhaustive within your dimension. Enumerate every single name the spec lists.
`

const SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    symbolsChecked: { type: 'integer' },
    missing: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          importPath: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['symbol', 'evidence'],
      },
    },
    behavioralMismatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          actual: { type: 'string' },
          pinnedByUpstreamTest: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['claim', 'actual', 'pinnedByUpstreamTest'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['dimension', 'symbolsChecked', 'missing', 'behavioralMismatches'],
}

const DIMENSIONS = [
  {
    key: 'root-api',
    prompt: `Dimension: package root API of \`sqlparse\`.
Spec claims these must exist and work:
- \`__version__\` == '0.5.4.dev0'
- \`__all__\` == ['engine', 'filters', 'formatter', 'sql', 'tokens', 'cli']
- \`parse(sql, encoding=None) -> tuple\` of Statement
- \`parsestream(stream, encoding=None)\` -> generator of Statement (works on a file object AND a str)
- \`format(sql, encoding=None, **options) -> str\`
- \`split(sql, encoding=None, strip_semicolon=False) -> list\`
- \`from sqlparse import format, parse, split, SQLParseError, Lexer, parsestream\` must all work
- \`from sqlparse import sql, tokens as T, keywords, lexer, utils\` must all work
- \`import sqlparse; sqlparse.cli\`, \`sqlparse.engine\`, \`sqlparse.filters\`, \`sqlparse.formatter\` accessible
- \`sqlparse/__main__.py\` exists and \`python3 -m sqlparse --help\` and \`python3 -m sqlparse.cli --help\` both exit 0
- the \`sqlformat\` console script is installed and works
Also verify every format() option named in the spec is ACCEPTED without raising:
keyword_case, identifier_case, strip_comments, reindent, indent_width, output_format,
use_space_around_operators, wrap_after, comma_first, strip_whitespace, right_margin,
indent_columns, indent_after_first, indent_tabs, truncate_strings, reindent_aligned, compact.
Note: the spec also lists \`preserve_newlines\` as a format option - check whether it is
accepted or rejected, and report which.`,
  },
  {
    key: 'sql-classes',
    prompt: `Dimension: /workspace/sqlparse/sql.py classes.
Enumerate and verify EVERY one of these exists with the listed members:
- Token: __slots__ == ('value','ttype','parent','normalized','is_keyword','is_group','is_whitespace','is_newline'); methods __init__,__str__,__repr__,_get_repr_name,_get_repr_value,flatten,match,within,is_child_of,has_ancestor
- TokenList: __slots__=='tokens'; __init__,__str__,__iter__,__getitem__,_get_repr_name,_pprint_tree,get_token_at_offset,flatten,get_sublists,_groupable_tokens(property),_token_matching,token_first,token_next_by,token_not_matching,token_matching,token_prev,token_next,token_index,group_tokens,insert_before,insert_after,has_alias,get_alias,get_name,get_real_name,get_parent_name,_get_first_name
- Statement (get_type), Parenthesis (M_OPEN=(T.Punctuation,'('), M_CLOSE=(T.Punctuation,')'), _groupable_tokens==tokens[1:-1])
- Identifier (is_wildcard,get_typecast,get_ordering,get_array_indices), IdentifierList (get_identifiers)
- Assignment, TypedLiteral (M_OPEN==[(T.Name.Builtin,None),(T.Keyword,'TIMESTAMP')], M_CLOSE==(T.String.Single,None), M_EXTEND==(T.Keyword,('DAY','HOUR','MINUTE','MONTH','SECOND','YEAR')))
- NameAliasMixin (get_real_name,get_alias), Function (get_parameters,get_window)
- SquareBrackets (M_OPEN/M_CLOSE with '[' ']'), Over (M_OPEN=(T.Keyword,'OVER'))
- Having (M_OPEN=(T.Keyword,'HAVING'), M_CLOSE=(T.Keyword,('ORDER BY','LIMIT')))
- Begin (M_OPEN 'BEGIN', M_CLOSE 'END'), Values, If (M_OPEN 'IF', M_CLOSE 'END IF')
- For (M_OPEN ('FOR','FOREACH'), M_CLOSE 'END LOOP'), Comparison (left/right properties)
- Comment (is_multiline), Where (M_OPEN 'WHERE', M_CLOSE includes 'ORDER BY','GROUP BY','LIMIT','UNION','UNION ALL','EXCEPT','HAVING','RETURNING','INTO')
- Case (M_OPEN 'CASE', M_CLOSE 'END', get_cases(skip_ws=False)), Operation, Command
Also verify the inheritance chains stated (e.g. Identifier is a NameAliasMixin and TokenList subclass).
Report exact values that differ from the spec (e.g. if Where.M_CLOSE contains extra members, that is
fine/additive - note it but do not call it missing).`,
  },
  {
    key: 'tokens-and-lexer',
    prompt: `Dimension: /workspace/sqlparse/tokens.py and /workspace/sqlparse/lexer.py.
tokens.py: verify \`_TokenType\` exists (subclass of tuple) with __contains__, __getattr__, __repr__,
and that these are all valid: T.Keyword, T.Operator, T.Name, T.String, T.Number, T.Punctuation,
T.Literal, T.Whitespace, T.Newline, T.Generic, T.Comment, T.Error, T.Other, T.Token,
T.Keyword.DML, T.Keyword.DDL, T.Keyword.CTE, T.Keyword.TZCast, T.Name.Builtin, T.Name.Placeholder,
T.String.Single, T.String.Symbol, T.Number.Integer, T.Number.Float, T.Number.Hexadecimal,
T.Comment.Single, T.Comment.Multiline, T.Comment.Multiline.Hint, T.Operator.Comparison,
T.Punctuation, T.Text.Whitespace, T.Text.Whitespace.Newline, T.Wildcard, T.Assignment, T.Command.
lexer.py: verify class Lexer with _default_instance, _lock (a threading Lock),
classmethod get_default_instance(), default_initialization(), clear(), set_SQL_REGEX(),
add_keywords(), is_keyword(), get_tokens(text, encoding=None); and module-level
\`tokenize(sql, encoding=None)\`. Verify \`list(tokenize('SELECT id, name FROM users'))\` yields
(ttype, value) 2-tuples and the first is a DML keyword. Verify get_default_instance() is a singleton
and thread-safety story (is _lock actually used?). Verify add_keywords + default_initialization
round-trip restores defaults.`,
  },
  {
    key: 'utils-keywords',
    prompt: `Dimension: /workspace/sqlparse/utils.py and /workspace/sqlparse/keywords.py.
utils.py must have: remove_quotes(val), split_unquoted_newlines(stmt), recurse(*cls), imt(token,i,m,t),
consume(iterator,n), offset(filter_,n=0) contextmanager, indent(filter_,n=1) contextmanager,
SPLIT_REGEX, LINE_MATCH.
Empirically verify remove_quotes behaviour for: None -> None, "'foo'" -> foo, '"foo"' -> foo,
'\`foo\`' -> foo, 'no_quotes' -> no_quotes, and the spec's odd example remove_quotes('"user\\"name"').
Verify split_unquoted_newlines does not split inside quoted strings (test with a CR inside a string).
Verify imt and recurse work as documented.
keywords.py must have: PROCESS_AS_KEYWORD, SQL_REGEX, KEYWORDS, KEYWORDS_COMMON, KEYWORDS_ORACLE,
KEYWORDS_MYSQL, KEYWORDS_PLPGSQL, KEYWORDS_HQL, KEYWORDS_MSACCESS, KEYWORDS_SNOWFLAKE,
KEYWORDS_BIGQUERY. Report the type/shape of SQL_REGEX and PROCESS_AS_KEYWORD.`,
  },
  {
    key: 'filters',
    prompt: `Dimension: /workspace/sqlparse/filters/ package.
Verify these are importable from \`sqlparse.filters\` (and from the stated submodule):
ReindentFilter (from sqlparse.filters.reindent; __init__ params width=2,char=' ',wrap_after=0,n='\\n',
comma_first=False,indent_after_first=False,indent_columns=False,compact=False; methods
_flatten_up_to_token, leading_ws property, _get_offset, nl, _next_token, _split_kwds, _split_statements,
_process, _process_where, _process_parenthesis, _process_function, _process_identifierlist,
_process_case, _process_values, _process_default, process),
RightMarginFilter (sqlparse.filters.right_margin; keep_together, __init__(width=79), _process, process),
_CaseFilter (sqlparse.filters.tokens; ttype=None, __init__(case=None), process),
KeywordCaseFilter (ttype==T.Keyword), IdentifierCaseFilter (ttype==(T.Name,T.String.Symbol), process),
TruncateStringFilter(width,char), AlignedIndentFilter (join_words, by_words, split_words class attrs
with the exact documented values; __init__(char=' ',n='\\n'), nl, _process_statement,
_process_parenthesis, _process_identifierlist, _process_case, _next_token, _split_kwds,
_process_default, _process, process),
StripCommentsFilter, StripWhitespaceFilter (_stripws,_stripws_default,_stripws_identifierlist,
_stripws_parenthesis, process(stmt,depth=0)), SpacesAroundOperatorsFilter,
StripTrailingSemicolonFilter, SerializerUnicode, OutputFilter (sqlparse.filters.output;
varname_prefix='', __init__(varname='sql'), _process, process), OutputPythonFilter,
OutputPHPFilter (varname_prefix='$').
Check the exact default of RightMarginFilter width and AlignedIndentFilter.split_words content
against the spec.`,
  },
  {
    key: 'engine-grouping',
    prompt: `Dimension: /workspace/sqlparse/engine/ package.
Verify \`from sqlparse.engine import FilterStack\` with __init__(strip_semicolon=False),
enable_grouping(), run(sql, encoding=None).
Verify \`from sqlparse.engine.statement_splitter import StatementSplitter\` with __init__, _reset,
_change_splitlevel, process.
Verify EVERY one of these exists in sqlparse.engine.grouping:
_group_matching, group_brackets, group_parenthesis, group_case, group_if, group_for, group_begin,
group_typecasts, group_tzcasts, group_typed_literal, group_period, group_as, group_assignment,
group_comparison, group_identifier, group_over, group_arrays, group_operator, group_identifier_list,
group_comments, group_where, group_aliased, group_functions, group_order, align_comments,
group_values, group, _group.
Also verify constants T_NUMERICAL == (T.Number, T.Number.Integer, T.Number.Float),
T_STRING == (T.String, T.String.Single, T.String.Symbol), T_NAME == (T.Name, T.Name.Placeholder).
Verify \`_group\` accepts the documented keyword params (cls, match, valid_prev, valid_next, post,
extend=False, recurse=True) by inspecting its signature.
Verify the spec's grouping examples: for "SELECT id, name FROM users WHERE status = 'active'",
type(parsed.tokens[2]) is IdentifierList and type(parsed.tokens[6]) is Where; and for
"SELECT * FROM (SELECT id FROM users) as sub", type(parsed.tokens[-1]) is Identifier.`,
  },
  {
    key: 'cli-formatter',
    prompt: `Dimension: /workspace/sqlparse/cli.py and /workspace/sqlparse/formatter.py.
cli.py: verify main(args=None)->int, create_parser()->argparse.ArgumentParser, _error(msg)->1.
Empirically exercise the CLI behaviours the spec documents (run them for real on a temp .sql file):
  sqlformat input.sql -r -k upper ; sqlformat --help ; sqlformat input.sql -o output.sql ;
  cat input.sql | sqlformat - ; sqlformat input.sql --encoding=utf-8 ; --in-place ;
Report the exit codes and whether each works. Also confirm main() returns 0 on success.
formatter.py: verify validate_options(options)->dict raising SQLParseError on bad values, and
build_filter_stack(stack, options). Verify the spec-mandated \`format_sql()\` function exists and
works. Verify FormatConfig / SplitConfig / ParseConfig dataclasses exist with EXACTLY the documented
field names and defaults:
  FormatConfig: keyword_case='upper', identifier_case=None, strip_comments=False, reindent=True,
    indent_width=2, comma_first=False, use_space_around_operators=False, right_margin=None
  SplitConfig: keep_trailing_semicolon=True, strip_whitespace=True
  ParseConfig: dialect='default', error_mode='strict'
and that they are frozen dataclasses. Report the import path(s) they are reachable from.`,
  },
  {
    key: 'examples-and-nodes',
    prompt: `Dimension: example helpers + the spec's "Detailed Implementation Nodes" worked examples.
1. Verify \`from sqlparse.examples.extract_table_names import is_subselect, extract_from_part,
   extract_table_identifiers, extract_tables\` works, and that
   extract_tables("SELECT * FROM users u JOIN orders o ON u.id = o.user_id") == ['users','orders'].
2. Verify \`from sqlparse.examples.column_defs_lowlevel import extract_definitions\` works on the
   CREATE TABLE example.
3. Verify the top-level /workspace/examples/*.py scripts still RUN standalone:
   \`cd /workspace && python3 examples/extract_table_names.py\` and
   \`python3 examples/column_defs_lowlevel.py\` - both must exit 0 and print output.
4. Now run these documented Node examples verbatim and report exactly what each produces:
   - format("select * from user;", reindent=True, keyword_case='upper')
   - format("select id, name from user where id=1 and status='active';", reindent=True, keyword_case='upper')
   - split("select 1; select 2; -- comment\\nselect 3;")
   - split("SELECT * FROM users; GO; SELECT * FROM orders;")  (spec claims len==2)
   - parse("SELECT id, name FROM user;")[0] token ttype/value dump
   - [parse(s)[0].get_type() for s in ("SELECT * FROM user;","INSERT INTO user VALUES (1,'Tom');","CREATE TABLE test(id INT);")]
   - parse("WITH cte AS (SELECT * FROM users) SELECT * FROM cte")[0].get_type()
   - format("SELECT id FROM users -- Get user ID", strip_comments=True)
   - format("SELECT /*+ INDEX(users idx_status) */ * FROM users", strip_comments=True)
   - format("select id, name from users", identifier_case='upper')
   - format('select "User Name" from "My Table"', identifier_case='upper')
   - format("SELECT id, name, email FROM users WHERE status='active' ORDER BY name", reindent=True)
   - format("SELECT a, b, c FROM table JOIN other ON table.id = other.id", reindent_aligned=True)
   - format("SELECT id+1, price*quantity FROM orders", use_space_around_operators=True)
   - format("SELECT a*b, c.* FROM table", use_space_around_operators=True)
   - format("select\\n* from      foo\\n\\twhere  ( 1 = 2 )\\n", strip_whitespace=True)
   - format("select id, name from user where id=1;", keyword_case='lower', reindent=True, indent_width=4, comma_first=True)
   - parse("SELECT id::integer, name::text FROM users")[0].tokens[2].get_typecast()
   - parse("SELECT user.id, user.name FROM user")[0].tokens[2].get_name() and .get_parent_name()
   - parse("SELECT id as user_id, name FROM users")[0].tokens[2].get_alias()
   - parse("SELECT $$complex string$$ FROM table"), parse("SELECT \`column name\` FROM \`table name\`")
   For EACH: state the actual output, whether it matches the spec's claimed output, and if it does
   not, grep /workspace/tests/ to determine whether the CURRENT behaviour is pinned by an upstream
   test (report the test name). This tells us whether the spec claim is fiction.`,
  },
  {
    key: 'robustness',
    prompt: `Dimension: robustness / error handling / stream processing / thread safety.
Empirically check:
- parse("SELECT FROM WHERE") does not raise (syntax tolerance) - report what it returns.
- parse("") , format(""), split(""), parse(None)? (report behaviour, do not crash the audit)
- parsestream on a real file object AND on a StringIO; also parsestream(str).
- format(sql, encoding='utf-8') and non-utf8 bytes handling; parse of a bytes input.
- Deeply nested SQL: "SELECT * FROM " + "(SELECT * FROM " * N + "t" + ")" * N for N in (5, 50, 200,
  600) - does it raise SQLParseError (DoS guard) and at what threshold? Is that guard covered by
  /workspace/tests/test_dos_prevention.py?
- Very long single statement / many statements (10k) - no quadratic blowup? time it roughly.
- Thread safety: run sqlparse.format/parse concurrently from 8 threads on distinct SQL, assert no
  exception and deterministic results.
- Idempotence: format(format(x, reindent=True), reindent=True) == format(x, reindent=True) for a few
  statements (report any that are not idempotent, this is informational).
- split with strip_semicolon=True and False on "select 1; select 2;".
- Unicode + binary payload round-trip through format(..., reindent=True).
Report anything that raises an UNEXPECTED exception (a traceback that is not a deliberate
SQLParseError). Those would be real bugs.`,
  },
  {
    key: 'packaging',
    prompt: `Dimension: packaging and project files.
- Read /workspace/pyproject.toml. Verify: [build-system] uses hatchling; [project.scripts] defines
  sqlformat; [tool.hatch.version] path = "sqlparse/__init__.py"; requires-python >= 3.8;
  readme points at a file that EXISTS; pytest is declared among the dependency lists.
- Verify the project actually builds: copy /workspace to /tmp/pkgcopy first (do NOT pollute
  /workspace), then run \`cd /tmp/pkgcopy && python3 -m pip wheel . --no-deps --no-build-isolation -w /tmp/wheeltest\`.
  Report success/failure. Then inspect the built wheel's file list and confirm the sqlparse package
  (including sqlparse/examples and py.typed) is included.
- Confirm \`pip install -e .\` already succeeded: \`cd /tmp && python3 -c "import sqlparse; print(sqlparse.__file__)"\`
  must work.
- Verify the file tree matches the spec's declared structure. Spec structure lists exactly:
  sqlparse/{__init__,__main__,cli,exceptions,formatter,keywords,lexer,sql,tokens,utils}.py,
  sqlparse/engine/{__init__,filter_stack,grouping,statement_splitter}.py,
  sqlparse/filters/{__init__,aligned_indent,others,output,reindent,right_margin,tokens}.py,
  plus top-level .flake8, .gitignore, .readthedocs.yaml, AUTHORS, CHANGELOG, CONTRIBUTING.md,
  LICENSE, Makefile, README.rst, SECURITY.md, TODO, examples/{column_defs_lowlevel,extract_table_names}.py,
  pyproject.toml.
  Report any REQUIRED file that is missing (actionable) and separately any extra files present
  (informational only).
- Run \`cd /workspace && python3 -m flake8 sqlparse/\` (config in /workspace/.flake8) and report the
  violation count and the distinct error codes. Informational, not a test failure.
- Confirm \`cd /workspace && python3 -m pytest tests/ -q\` still reports 477 passed.`,
  },
]

phase('Audit')
const audited = await pipeline(
  DIMENSIONS,
  d => agent(`${COMMON}\n${d.prompt}\n\nReturn your findings in the structured schema. Set dimension="${d.key}".`,
             { label: `audit:${d.key}`, phase: 'Audit', schema: SCHEMA }),
  (res, d) => {
    if (!res) return null
    const items = [
      ...res.missing.map(m => ({ kind: 'missing', dimension: d.key, symbol: m.symbol, importPath: m.importPath, evidence: m.evidence })),
      ...res.behavioralMismatches
        .filter(b => !b.pinnedByUpstreamTest)
        .map(b => ({ kind: 'mismatch', dimension: d.key, symbol: b.claim, evidence: `actual: ${b.actual}. ${b.note || ''}` })),
    ]
    return { dimension: d.key, symbolsChecked: res.symbolsChecked, notes: res.notes || '', items }
  },
  (r) => {
    if (!r || !r.items.length) return r
    return parallel(r.items.map(it => () =>
      agent(`${COMMON}

An earlier auditor reported this potential gap in the /workspace sqlparse implementation:

  kind:      ${it.kind}
  symbol:    ${it.symbol}
  import:    ${it.importPath || '(unspecified)'}
  evidence:  ${it.evidence}

Your job is to ADVERSARIALLY VERIFY it. Default to refuted=true when uncertain.
1. Reproduce it yourself with a real python3 command. Does it actually fail?
2. If it is a missing symbol: would ADDING it be purely additive and safe (no existing behavior
   changed, no upstream test affected)? Check /workspace/tests/ for anything that would conflict,
   including any assertion on \`sqlparse.__all__\`.
3. If it is a behavioral mismatch: re-grep /workspace/tests/ hard. If ANY upstream test pins the
   current behavior, this is spec-fiction -> refuted=true, because /workspace/tests/ is the
   authoritative bar and we must not break it.
4. Run \`cd /workspace && python3 -m pytest tests/ -q | tail -2\` and confirm the suite is at
   477 passed. Report that number.
Then state a concrete minimal recommended fix (or "none").`,
        { label: `verify:${it.dimension}:${String(it.symbol).slice(0, 40)}`, phase: 'Verify',
          schema: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              refuted: { type: 'boolean' },
              reproduced: { type: 'string' },
              safeToAdd: { type: 'boolean' },
              suiteStillGreen: { type: 'boolean' },
              recommendedFix: { type: 'string' },
              severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
            required: ['symbol', 'refuted', 'reproduced', 'recommendedFix', 'severity'],
          } })
        .then(v => ({ ...it, verdict: v }))
    )).then(verified => ({ ...r, items: verified.filter(Boolean) }))
  },
)

const rows = audited.filter(Boolean)
const confirmed = rows.flatMap(r => r.items).filter(it => it.verdict && !it.verdict.refuted)
log(`audited ${rows.length} dimensions; ${rows.flatMap(r => r.items).length} candidate gaps; ${confirmed.length} confirmed`)

phase('Synthesize')
const summary = await agent(`${COMMON}

Below are the CONFIRMED gaps that survived adversarial verification, plus per-dimension notes,
from an exhaustive audit of the /workspace sqlparse implementation against its specification.

CONFIRMED GAPS:
${JSON.stringify(confirmed.map(c => ({ dimension: c.dimension, kind: c.kind, symbol: c.symbol, fix: c.verdict.recommendedFix, severity: c.verdict.severity, safeToAdd: c.verdict.safeToAdd })), null, 2)}

PER-DIMENSION NOTES:
${JSON.stringify(rows.map(r => ({ dimension: r.dimension, symbolsChecked: r.symbolsChecked, notes: r.notes })), null, 2)}

Produce a single prioritized, de-duplicated action list for the implementer. For each action give:
the exact file to change, the exact minimal edit, and why it is safe (must not break the 477-test
upstream suite). Put anything that is spec-fiction (i.e. the spec's documented output is simply wrong
about real sqlparse behavior and upstream tests pin the opposite) into a separate
"DO NOT CHANGE" list with one line each. Be concise and concrete. If there is nothing actionable,
say so plainly and explicitly confirm which dimensions came back fully clean.`,
  { label: 'synthesize', phase: 'Synthesize' })

return { confirmedCount: confirmed.length, confirmed, summary }
