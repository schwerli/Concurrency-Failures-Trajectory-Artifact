export const meta = {
  name: 'sqlparse-blackbox-spec',
  description: 'Black-box probe sqlparse.format(keyword_case=upper) behavior via the prebuilt executable, and harvest its keyword set',
  phases: [
    { title: 'Probe', detail: 'one agent per lexer/serializer dimension' },
    { title: 'Crosscheck', detail: 'adversarially re-verify each dimension spec' },
    { title: 'Keywords', detail: 'generate + probe long/underscored keyword candidates' },
  ],
}

const COMMON = `
# Context
You are reverse-engineering, PURELY BLACK-BOX, the behavior of this Python program:

    import argparse, sqlparse
    def main():
        parser = argparse.ArgumentParser()
        parser.add_argument('--a', type=str, required=True)
        args = parser.parse_args()
        result = sqlparse.format(args.a, keyword_case='upper')
        print(result)

A self-contained executable of it is at /workspace/dataset/test4_executable .
Run it as:  /workspace/dataset/test4_executable --a 'SOME SQL'

HARD RULES (violating these invalidates your work):
- Do NOT read/extract/strings/unzip/decompile the executable. Do NOT look for sqlparse source on disk.
- Do NOT run 'python'/'python3' to import sqlparse.
- Do NOT pip install anything. Do NOT use the network.
- Observe ONLY via running the executable with different --a values.

A batch prober helper exists: run  node /tmp/probe/run.mjs <file.json> <concurrency>
where file.json is a JSON array of input strings; it prints JSON [{i,out,err,rc}].
You may also call the executable directly in bash loops, or write your own node helper under /tmp/probe/.
ALWAYS inspect output byte-exactly (pipe through 'cat -A' or 'od -c', or use JSON.stringify in node)
because trailing/leading whitespace and newline normalization matter enormously.

# Established ground truth (do not re-derive, build on it)
Internally sqlparse: (1) lexes the string with an ORDERED list of regexes (re.IGNORECASE|re.UNICODE),
each tried with compiled_pattern.match(text, pos) at the current position -- so LOOKBEHIND can see
characters before pos; first regex that matches wins; an unmatched char yields Token.Error with that
single char. (2) A KeywordCaseFilter uppercases the value of every token whose type is a subtype of
Token.Keyword (Keyword, Keyword.DML, Keyword.DDL, Keyword.CTE, Keyword.Order, Keyword.TZCast, ...).
Nothing else is uppercased -- notably Token.Name, Token.Name.Builtin, Token.Operator.Comparison,
Token.Literal and Token.Error are left as-is. (3) A StatementSplitter splits the token stream into
statements; after a ';' at nesting level <= 0 it sets consume_ws=True, and the next token that is NOT
exactly Whitespace and NOT exactly Comment.Single closes the statement (Newline is a DISTINCT token
type from Whitespace, so a newline closes it). (4) Each statement is serialized by splitting its text
on newlines (\\r\\n, \\r or \\n), right-stripping every line, and joining with '\\n'. So \\r and \\r\\n are
normalized to \\n, and trailing horizontal whitespace before every newline (and at statement end) is
deleted. (5) format() returns ''.join(statements); print() adds one trailing '\\n'.
Confirmed examples:
  'select 1;   select 2'        -> 'SELECT 1;SELECT 2'
  'select 1;\\n   select 2   '   -> 'SELECT 1;\\n   SELECT 2'
  'select 1; /*c*/ select 2'    -> 'SELECT 1;/*c*/ SELECT 2'
  'select 1;-- c\\nselect 2'     -> 'SELECT 1;-- c\\nSELECT 2'
  'a  \\nb  \\nc  '               -> 'a\\nb\\nc'
  'a\\rb' -> 'a\\nb' ; 'a\\r\\nb' -> 'a\\nb'
  'select ... where name like ...' -> LIKE stays lowercase (Operator.Comparison, not Keyword)
  'count' -> 'COUNT' but 'count(' -> 'count(' (rule '[A-Z]\\w*(?=\\()' -> Name wins)
  'a go b' -> 'a GOb'  (GO is a keyword AND behaves like a statement terminator: eats following ws)
  'select      1' -> 'SELECT      1' (internal whitespace preserved verbatim)

# Your deliverable
A precise, IMPLEMENTABLE specification of YOUR assigned dimension, expressed as an ordered list of
lexer rules (regex-like notation is fine for describing; we will hand-implement a char-by-char lexer
with NO regex), plus every counter-example you found. Include concrete (input -> exact stdout) pairs
that a reimplementation must satisfy, using \\n / \\t escapes so whitespace is unambiguous. Be exhaustive
and adversarial: hunt for inputs where the "obvious" rule is wrong. Aim for 60+ distinct probes.
Also save your raw probe log to /tmp/probe/reports/<your-dimension>.md .
`;

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'spec', 'testVectors', 'openQuestions'],
  properties: {
    dimension: { type: 'string' },
    spec: { type: 'string', description: 'Markdown: ordered rules + precise semantics, implementable without further probing' },
    testVectors: {
      type: 'array',
      description: 'Concrete input/expected-stdout pairs (stdout INCLUDING the final newline from print)',
      items: {
        type: 'object', additionalProperties: false, required: ['input', 'stdout'],
        properties: { input: { type: 'string' }, stdout: { type: 'string' }, why: { type: 'string' } },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
};

const KW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['bucket', 'confirmedKeywords', 'confirmedNonKeywords', 'candidateCount', 'file'],
  properties: {
    bucket: { type: 'string' },
    confirmedKeywords: { type: 'array', items: { type: 'string' }, description: 'lowercase candidates that came back UPPERCASED' },
    confirmedNonKeywords: { type: 'array', items: { type: 'string' }, description: 'notable SQL words that did NOT uppercase (surprises only)' },
    candidateCount: { type: 'integer' },
    file: { type: 'string', description: 'absolute path of the file where you saved the confirmed keyword list, one per line' },
  },
};

const DIMENSIONS = [
  {
    key: 'comments',
    prompt: `Dimension: COMMENTS.
Pin down exactly: '--' line comments, '# ' comments (note the space!), '#' without space, '--+' and
'/*+ ... */' optimizer HINT variants, '/* ... */' multiline comments, unterminated '/*', nested '/*',
comment at very end without newline, '--' immediately at start, comments around ';'.
Determine (a) exactly which characters each comment token consumes (does the trailing newline belong to
the token?), (b) how comments interact with the statement splitter's consume_ws (single-line comment is
in EOS_TTYPE, multiline is NOT), (c) whether keywords inside comments are uppercased (they must not be),
(d) what happens with '#' followed by a letter vs a space vs a digit, (e) '--' at end of input,
(f) whether '\\r' terminates a line comment, (g) unterminated '/*' to EOF: one token or Error tokens?
Also test '# ' vs '#x' vs '#' alone at various positions and after '.'; and '--+x', '/*+x*/', '#+x'.`,
  },
  {
    key: 'splitter-serializer',
    prompt: `Dimension: STATEMENT SPLITTING + SERIALIZATION (whitespace/newlines). Highest-risk dimension.
Pin down exactly:
- The nesting-level logic deciding whether a ';' actually terminates a statement. Test ';' inside
  parentheses: 'select (1;   2)', 'create table t (a int;   b int);   select 1'. Test CREATE ... BEGIN
  ... END; DECLARE; CASE/WHEN/END; 'create or replace function f() begin select 1;   select 2; end;   select 3'.
  Craft inputs where the ONLY observable difference is whether whitespace after an inner ';' survives
  (whitespace after a TERMINATING ';' is deleted; after a non-terminating ';' it survives).
- GO: exact rule. 'go' alone? 'go 5'? 'go5'? 'xgo'? 'go' inside parens? Must it start a line? Does it
  need level<=0? Test 'select 1 go   select 2', 'select 1 go 3   select 2', '(go   b)', 'a,go   b',
  'go   go   go', 'select 1 GO   select 2', 'goo   x'.
- Per-line right-strip: confirm trailing spaces/tabs before EVERY newline are removed, INCLUDING inside
  '/* ... */' comments and inside string literals spanning newlines (CRITICAL: test
  "select 'a  \\nb  ' , 1" and "select /*x  \\ny  */ 1").
- Which characters are whitespace for the lexer and which are newlines for the serializer: ' ', '\\t',
  '\\n', '\\r', '\\r\\n', '\\x0b', '\\x0c', '\\x1c'..'\\x1f', '\\x85', '\\xa0', '\\u2028', '\\u2029', '\\u3000'.
- Statements consisting only of whitespace are dropped: test ' ; ', ';;;', '   ', '\\n\\n', ' \\n ; \\n '.
- ';' then Newline then spaces then token (newline closes stmt, so the spaces survive).
- Empty input ''.`,
  },
  {
    key: 'strings',
    prompt: `Dimension: STRING / QUOTED LITERALS.
Pin down: single-quoted strings with '' doubling and backslash escapes (\\\\ and \\'), double-quoted
"..." (String.Symbol) with "" doubling and backslash escapes, backtick \`...\` with \`\` doubling, the
acute-accent variant U+00B4 ...U+00B4, unterminated quotes of each kind, empty '' / "" / \`\`,
dollar-quoted strings with empty tag and named tag (including the (?<!\\S) requirement that the opening
'$' is not preceded by a non-space character), and the fallback double-quote rule ('' | ".*?[^\\\\]").
Confirm keywords inside strings are NOT uppercased; a string containing ';' does not split statements;
determine empirically whether a string containing a newline with trailing spaces IS still line-rstripped.
Test inputs such as: "select 'a;b' , x", "select 'it''s' , x", "select 'a\\\\'b' , x",
'select "select" from t', 'select \`select\` , 1', 'select \`a\`\`b\` , 1',
'select $$ select ; select $$ , 1', 'select $tag$ x $tag$ , 1', 'a$$b$$ , 1', 'select $$ unterminated',
"select 'unterminated", 'select "unterminated', 'select \`unterminated', "select '' , 1",
'select "" , 1', 'select $$$$ , 1', 'select $a$x$a$ , select', "select 'a\\n  b  \\n' , 1".`,
  },
  {
    key: 'numbers',
    prompt: `Dimension: NUMERIC LITERALS and their boundaries.
Rules under test (in lexer order): '-?0x[\\dA-F]+' hex; '-?\\d+(\\.\\d+)?E-?\\d+' float;
'(?![_A-Z])-?(\\d+(\\.\\d*)|\\.\\d+)(?![_A-Z])' float; '(?![_A-Z])-?\\d+(?![_A-Z])' integer.
Numbers are never uppercased, so the OBSERVABLE effect is on neighbouring tokens: e.g. whether '5day'
lexes as Number + Keyword(DAY -> 'DAY') or as one Name token (staying lowercase). USE THAT: probe with
keyword suffixes/prefixes: '5day', '5 day', '0x1day', '1.5day', '.5day', '-5day', 'a-5day', 'day5',
'_5day', '1_day', 'select 1e5day', 'select 0xaday', 'select 1.day', 'select 1..day', '1.5.day'.
Also '1e-5', '1e+5', '1.2e3', '0x1f', '0xzz', '1.', '.1', '1.2.3', '--5' (comment!), 'a--5', '3-4',
'3 - 4', '-.5', '1e', 'e5', '1e5', '2E10', '9223372036854775808', '007', '0b101', '1_000'.
Determine each rule's exact character consumption from what stays lowercase vs uppercase.`,
  },
  {
    key: 'names-placeholders',
    prompt: `Dimension: NAMES, PLACEHOLDERS, COMMANDS, BRACKETS.
Rules under test (lexer order matters):
  '\\?' -> Name.Placeholder ; '%(\\(\\w+\\))?s' -> Name.Placeholder ; '(?<!\\w)[$:?]\\w+' -> Name.Placeholder
  '\\\\\\w+' -> Command ; '(@|##|#)[A-Z]\\w+' -> Name ; '[A-Z]\\w*(?=\\s*\\.)' -> Name ;
  '(?<=\\.)[A-Z]\\w*' -> Name ; '[A-Z]\\w*(?=\\()' -> Name ; '(?<![\\w\\])])(\\[[^\\]\\[]+\\])' -> Name
Because Name/Placeholder/Command are never uppercased, use KEYWORD words as the payload to detect which
rule fired. Probe: 'select @select', 'select ##select', 'select #select', 'select #s', '@1a', ':select',
'$select', '?select', '%s', '%(select)s', '%select', '\\\\select', 'select \\\\g', 'a.select', 'a . select',
'select.a', 'select . a', 'select  .  a', 'select\\n.\\na', 'a.b.select', '[select]', 'x[select]',
'x)[select]', 'x][select]', '[sel]ect', 'count(1)', 'count (1)', 'count\\n(1)', 'select(1)', 'from(1)',
'as(1)', 'in(1)', 'values(1)', 'using(1)', 'case(1)', 'end(1)', 'join(1)', 'like(1)', 'group(1)',
'order(1)', 'union(1)', 'not(1)', 'nulls(1)', 'create(1)', 'month(1)'.
CRITICAL: determine whether '(?<=\\.)[A-Z]\\w*' actually fires (a source comment claims it never does) by
checking whether 'a.select' keeps 'select' lowercase. Determine whether '[A-Z]\\w*(?=\\s*\\.)' allows \\n
and \\t in the \\s* part. Determine whether the '(CASE|IN|VALUES|USING|FROM|AS)' rule (which is EARLIER
in the list) beats the '(?=\\()' and '(?=\\s*\\.)' rules. Also test '$1', ':1', '?1', ':a.b', '%%s',
'%(a b)s', and whether a placeholder can start with a digit.`,
  },
  {
    key: 'multiword-keywords',
    prompt: `Dimension: MULTI-WORD KEYWORD REGEXES.
Under test (each is a SINGLE token whose whole value gets uppercased, so internal whitespace is
preserved but you can detect the token span):
  JOIN family: '((LEFT\\s+|RIGHT\\s+|FULL\\s+)?(INNER\\s+|OUTER\\s+|STRAIGHT\\s+)?|(CROSS\\s+|NATURAL\\s+)?)?JOIN\\b'
  'END(\\s+IF|\\s+LOOP|\\s+WHILE)?\\b' ; 'NOT\\s+NULL\\b' ; 'NULLS\\s+(FIRST|LAST)\\b' ; 'UNION\\s+ALL\\b'
  'CREATE(\\s+OR\\s+REPLACE)?\\b' ; 'DOUBLE\\s+PRECISION\\b' ; 'GROUP\\s+BY\\b' ; 'ORDER\\s+BY\\b'
  'HANDLER\\s+FOR\\b' ; '(LATERAL\\s+VIEW\\s+)(EXPLODE|INLINE|PARSE_URL_TUPLE|POSEXPLODE|STACK)\\b'
  "(AT|WITH')\\s+TIME\\s+ZONE\\s+'[^']+'" ; '(NOT\\s+)?(LIKE|ILIKE|RLIKE)\\b' ; '(NOT\\s+)?(REGEXP)\\b'
  '(CASE|IN|VALUES|USING|FROM|AS)\\b'
Verify each rule EXISTS in this build, its exact alternatives, and how much whitespace it swallows
(multiple spaces? newlines? tabs? comments?). KEY TRICK: 'not   like' -> if it is ONE
Operator.Comparison token then NOTHING uppercases, so 'not' stays lowercase; whereas 'not,like' ->
'NOT,like'. Use that pattern to detect single-token spans for EVERY multiword rule, e.g.
'left  join' vs 'left,join'; 'group  by'; 'order\\nby'; 'not\\nnull'; 'nulls  first'; 'nulls last';
'union  all'; 'create  or  replace'; 'double  precision'; 'handler for'; 'end  if'; 'end loop';
'end while'; 'end for'; 'lateral view explode'; "at time zone 'utc'"; "with' time zone 'x'";
'natural left join'; 'left outer join'; 'cross join'; 'straight join'; 'inner join'; 'full outer join';
'right straight join'; 'natural inner join'; 'cross inner join'; 'left cross join'; 'group by by'.
Also test case-insensitivity of inner words ('LeFt JoIn'), and 'group/*c*/by'.
Report which of these rules DO NOT exist in this build, and any EXTRA multiword rules you discover
(hunt for them: try 'is not', 'not in', 'not exists', 'is null', 'is not null', 'primary key',
'foreign key', 'on delete', 'on update', 'partition by', 'within group', 'rows between',
'range between', 'unbounded preceding', 'current row', 'for update', 'insert into', 'delete from',
'if exists', 'if not exists', 'with recursive', 'select distinct', 'character varying',
'time zone', 'timestamp with time zone', 'bit varying', 'national character', 'grant option').`,
  },
  {
    key: 'operators-errors',
    prompt: `Dimension: OPERATORS, PUNCTUATION, ASSIGNMENT, WILDCARD, ERROR tokens.
Under test: ':=' Assignment ; '::' Punctuation ; '*' Wildcard ; '[;:()\\[\\],.]' Punctuation ;
'[<>=~!]+' Operator.Comparison ; '[+/@#%^&|^-]+' Operator ; final fallback Token.Error (1 char).
None of these uppercase, so probe by placing KEYWORD words adjacent and seeing which stay lowercase, and
by checking whether characters are preserved. CRITICAL: find which characters produce Token.Error and
confirm Error tokens still appear verbatim in the output (nothing should ever be deleted except
whitespace via rstrip). Probe: 'a:=b', 'a::b', 'a:b', 'a:=:=b', '<>', '>=', '!=', '!!', '~~', '=~',
'<=>', 'a+b', 'a-b', 'a--b', 'a/b', 'a%b', 'a^b', 'a|b', 'a&b', 'a@b', 'a#b', 'a+-*/b', 'select 1 & 2',
'a{b}c', 'a$b', "a'b", 'a\\\\b', and each of '{', '}', '"', "'", '\\\\', '$', '!', '~', '?', ';', ':',
standing alone and adjacent to a keyword like 'select'. Also '%s' vs '%' vs '%(x)s' vs '%(x)y', and
whether ':' before a word becomes a placeholder but ':' before a digit or space is punctuation.
Also: does '*' after a keyword matter ('select*from t')? Is '->' / '->>' / '#>' / '#>>' / '||' / '<<' /
'>>' / '@>' / '<@' one token or several, and does the splitting affect adjacent keyword detection?`,
  },
  {
    key: 'unicode-encoding',
    prompt: `Dimension: NON-ASCII / UNICODE.
The lexer uses re.IGNORECASE|re.UNICODE; several classes are written as [A-ZÀ-Ü] (U+00C0..U+00DC, which
with IGNORECASE also matches U+00E0..U+00FC) and \\w (Unicode word chars).
Determine empirically: (1) Do 'é','ü','中','Ω','א','ñ','ß' count as word chars inside an identifier
(does 'sel\\u00e9ct' stay one Name token; does 'from\\u00e9' stay lowercase; does '\\u00e9from' ->
'\\u00e9from' or '\\u00e9FROM')? (2) Does a leading non-ASCII letter let the '[A-ZÀ-Ü]\\w*(?=\\()' rule
fire (compare 'ü(1)' vs '\\u4e2d(1)' vs 'a(1)')? Use adjacency with keywords to detect token boundaries.
(3) Are non-ASCII digits (Arabic-Indic U+0660, superscript U+00B2) word chars? (4) Is U+00A0 whitespace
for the lexer? Are U+2028/U+2029/U+0085 newlines for the serializer? Are \\x0b \\x0c \\x1c..\\x1f
whitespace or newline? (5) Does uppercasing use full Unicode case mapping? (6) Confirm output encoding
is UTF-8 and characters round-trip; try a 4-byte emoji and a combining mark. (7) Test the acute accent
U+00B4 quoting and 'À-Ü' range members specifically: probe 'À','Á','Ö','Ø','Ü','Ý','ß','à','ö','ø','ü','ý','þ'.
Report exactly which code points behave as \\w, as \\s, and as newline.`,
  },
  {
    key: 'argparse',
    prompt: `Dimension: COMMAND-LINE ARGUMENT PARSING (Python argparse).
The program is: parser = argparse.ArgumentParser(); parser.add_argument('--a', type=str, required=True).
Determine byte-exactly (capture stdout, stderr and exit code SEPARATELY) the behavior for:
no args; '--a' with no value; '--a x'; '--a=x'; '--a='; '--a x --a y'; '-a x'; '--a x extra';
'extra --a x'; '--b x'; '-h'; '--help'; '--he'; '--A x'; '--a --b'; '--a -h'; '--a -- x'; '-- --a x';
'--a -1'; '--a=-1'; '--a "- x"'; '--a "-x"'; '--a=--b'; a value containing newlines; '--a x --help';
'--help --a x'; '--a ""'; '--aa x'; '-ha'; '--=x'; '---a x'.
Report the EXACT usage/error text and exit codes, and which stream each goes to. Note the program name
shown in usage (derived from sys.argv[0] basename). Deliver a precise algorithm for a faithful manual
process.argv parser: option '--a' (required, string), '-h/--help', support '--a=VALUE' and '--a VALUE',
prefix abbreviation, '--' separator, the negative-number heuristic, and exact error messages/exit codes.
Also report the exact --help text including indentation and blank lines.`,
  },
  {
    key: 'keyword-context',
    prompt: `Dimension: KEYWORD-vs-NAME CONTEXT RULES (highest-frequency real-world behavior).
A word in the KEYWORDS dicts normally uppercases, but earlier lexer rules can turn it into a Name
(staying lowercase). Systematically map, for these ~50 keywords -- select, from, where, as, in, values,
using, case, end, join, group, order, union, not, null, nulls, like, create, count, month, day, year,
user, table, index, view, key, set, on, and, or, is, between, when, then, else, limit, desc, asc,
distinct, having, left, cross, natural, double, precision, handler, at, with, zone, time, go, all, some
-- what happens in each of these contexts:
  'KW'   'KW('   'KW ('   'KW\\n('   'KW.'   'KW .'   'KW  .'   '.KW'   'a.KW'   'a . KW'   'a.KW('
  '@KW'  '#KW'   '##KW'   ':KW'    '$KW'   '[KW]'   'KW]'      'x)KW'  'KW;'    'KW,'      '(KW)'
  'KW1'  '1KW'   'KW_'    '_KW'    'KW$'   'KW#'    '#KW#'     'KW"'   '"KW"'   'KW\\\\'
Report a compact decision procedure covering all of it. Especially nail: does '[A-Z]\\w*(?=\\s*\\.)'
allow \\n/\\t in \\s*? Does '(?<=\\.)[A-Z]\\w*' fire? Does the '(CASE|IN|VALUES|USING|FROM|AS)' rule beat
the '(?=\\()' and '(?=\\s*\\.)' rules? Does 'end(' become a Name while 'end' is Keyword? Do 'KW$' /
'KW#' lex as one token via '\\w[$#\\w]*' and therefore fail keyword lookup?`,
  },
  {
    key: 'realistic-sql',
    prompt: `Dimension: END-TO-END REALISTIC SQL REGRESSION CORPUS.
Do not derive rules. Build a large, diverse regression corpus (aim 200+ statements) of realistic SQL a
grader might use, run each through the executable, and record byte-exact stdout.
Cover: SELECT with every join kind, subqueries, CTEs (WITH ... AS), window functions (OVER, PARTITION
BY, ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), CASE/WHEN/ELSE/END, aggregates, GROUP BY/HAVING/
ORDER BY/LIMIT/OFFSET/FETCH, UNION/UNION ALL/INTERSECT/EXCEPT, INSERT/UPDATE/DELETE/MERGE, DDL
(CREATE/ALTER/DROP TABLE/VIEW/INDEX/SEQUENCE/TRIGGER/FUNCTION/PROCEDURE, IF EXISTS, ON DELETE CASCADE,
PRIMARY KEY, FOREIGN KEY, CHECK, DEFAULT, NOT NULL, UNIQUE, AUTO_INCREMENT, SERIAL), data types
(int, varchar(255), numeric(10,2), timestamp with time zone, double precision, jsonb, uuid, text[]),
casts (::), string functions, date functions (date_trunc, extract(month from x), interval '1 day'),
JSON operators (->, ->>, #>), regex operators (~, ~*, !~), NULL handling (IS NULL, IS NOT NULL,
COALESCE, NULLIF), EXISTS/IN/ANY/ALL, LIKE/ILIKE/NOT LIKE, BETWEEN, multi-statement scripts with ';'
and varied whitespace/newlines/indentation, interleaved comments, GRANT/REVOKE, EXPLAIN ANALYZE,
BEGIN/COMMIT/ROLLBACK/SAVEPOINT, SET/SHOW, T-SQL @vars and #temp tables, MySQL backticks and
'LIMIT x,y', Oracle-isms (DUAL, NVL, ROWNUM, CONNECT BY, MINUS, (+)), Hive LATERAL VIEW, PL/pgSQL
DECLARE/BEGIN/END blocks with inner ';', dollar-quoted function bodies, and pathological whitespace
(tabs, CRLF, trailing spaces on each line, leading blank lines).
Write the corpus as a JSON array of input strings to /tmp/probe/corpus/realistic.json and the observed
outputs to /tmp/probe/corpus/realistic_expected.json (array of stdout strings, same order, INCLUDING
the trailing newline). VERIFY the two files have equal length and reload them to confirm valid JSON.
In your 'spec' field summarise only the SURPRISES (where output differs from the naive "uppercase every
SQL keyword" expectation). In testVectors include the 40 most surprising pairs.`,
  },
];

const KW_BUCKETS = [
  { key: 'ansi-long', prompt: `ANSI/ISO SQL standard reserved + non-reserved words (SQL-86/89/92/99/2003/2008/2011/2016), including every word from the standard's reserved word lists and the INFORMATION_SCHEMA vocabulary. Include underscored ones (CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_USER, CURRENT_ROLE, CURRENT_PATH, CURRENT_SCHEMA, CURRENT_CATALOG, SESSION_USER, SYSTEM_USER, CHARACTER_LENGTH, CHAR_LENGTH, BIT_LENGTH, OCTET_LENGTH, DATETIME_INTERVAL_CODE, DATETIME_INTERVAL_PRECISION, CHARACTER_SET_CATALOG, CHARACTER_SET_NAME, CHARACTER_SET_SCHEMA, COLLATION_CATALOG, COLLATION_NAME, COLLATION_SCHEMA, CONDITION_NUMBER, CONNECTION_NAME, CONSTRAINT_CATALOG, CONSTRAINT_NAME, CONSTRAINT_SCHEMA, CURSOR_NAME, DYNAMIC_FUNCTION, DYNAMIC_FUNCTION_CODE, MESSAGE_LENGTH, MESSAGE_OCTET_LENGTH, MESSAGE_TEXT, MORE, RETURNED_LENGTH, RETURNED_OCTET_LENGTH, RETURNED_SQLSTATE, ROW_COUNT, SERVER_NAME, SPECIFIC_NAME, SUBCLASS_ORIGIN, TABLE_NAME, TRIGGER_CATALOG, TRIGGER_NAME, TRIGGER_SCHEMA, PARAMETER_MODE, PARAMETER_NAME, ROUTINE_CATALOG, SCOPE_CATALOG, USER_DEFINED_TYPE_CODE, KEY_MEMBER, KEY_TYPE, TIMEZONE_HOUR, TIMEZONE_MINUTE, ...). Aim for 1200+ candidates.` },
  { key: 'postgres', prompt: `PostgreSQL + PL/pgSQL keywords, type names and reserved words, plus every pg-specific word (TABLESPACE, UNLOGGED, MATERIALIZED, CONCURRENTLY, RETURNING, LATERAL, TABLESAMPLE, GENERATED, IDENTITY, SEQUENCE, PLPGSQL, RAISE, NOTICE, EXCEPTION, PERFORM, LOOP, ELSIF, RETURN, VARIADIC, SETOF, DOMAIN, AGGREGATE, OPERATOR, EXTENSION, PUBLICATION, SUBSCRIPTION, VACUUM, ANALYZE, CLUSTER, REINDEX, LISTEN, NOTIFY, UNLISTEN, COPY, INHERITS, OIDS, TOAST, STYPE, SFUNC, SYSID, ENCRYPTED, VALIDATOR, WRAPPER, ...) and pg types (SMALLINT, BIGINT, NUMERIC, DECIMAL, VARCHAR, VARBIT, TSVECTOR, TSQUERY, INTERVAL, TIMESTAMPTZ, MACADDR, INET, CIDR, POLYGON, CIRCLE, LSEG, BOX, JSONB, HSTORE, BYTEA, SERIAL, BIGSERIAL, MONEY, XML, UUID, ...). Aim for 1200+ candidates.` },
  { key: 'mysql-hive', prompt: `MySQL/MariaDB keywords (DELAYED, DISTINCTROW, ENCLOSED, ESCAPED, FULLTEXT, HIGH_PRIORITY, LOW_PRIORITY, LOCALTIME, LOCALTIMESTAMP, MEDIUMINT, MIDDLEINT, OPTIMIZE, OPTIONALLY, SPATIAL, SQL_BIG_RESULT, SQL_CALC_FOUND_ROWS, SQL_SMALL_RESULT, STARTING, STRAIGHT_JOIN, TERMINATED, UNSIGNED, ZEROFILL, AUTO_INCREMENT, ENGINE, CHARSET, COLLATE, TINYINT, MEDIUMTEXT, LONGTEXT, LONGBLOB, ENUM, ...) plus Hive/HQL and Spark SQL keywords (LATERAL, EXPLODE, INLINE, POSEXPLODE, PARSE_URL_TUPLE, STACK, CLUSTERED, DISTRIBUTE, SORTED, STORED, SERDE, SERDEPROPERTIES, TBLPROPERTIES, PARTITIONED, BUCKETS, MSCK, RLIKE, REGEXP, SEMI, ANTI, ...). Aim for 1200+ candidates.` },
  { key: 'oracle-tsql-db2', prompt: `Oracle + PL/SQL keywords (ARCHIVELOG, AUTOEXTEND, CONNECT, CONSTRAINT, DBTIMEZONE, EXCLUSIVE, IDENTIFIED, INITRANS, MAXEXTENTS, MINEXTENTS, NOAUDIT, NOCACHE, NOCOMPRESS, NOLOGGING, PCTFREE, PCTINCREASE, PCTUSED, PRIVILEGES, ROWNUM, ROWID, SEGMENT, SUCCESSFUL, SYNONYM, TABLESPACE, TRUNCATE, UNLIMITED, VARCHAR2, NVARCHAR2, SYSDATE, SYSTIMESTAMP, PRAGMA, EXCEPTION_INIT, ...), T-SQL/SQL Server (NONCLUSTERED, IDENTITYCOL, IDENTITY_INSERT, TEXTSIZE, ROWGUIDCOL, WAITFOR, OPENQUERY, OPENROWSET, OPENXML, OPENDATASOURCE, READTEXT, WRITETEXT, UPDATETEXT, TABLESAMPLE, BULK, NOCHECK, SETUSER, DBCC, ...), DB2/Informix, and MS Access/Jet (DISTINCTROW, PARAMETERS, TRANSFORM, PIVOT, UNPIVOT, YESNO, LONGTEXT, LONGBINARY, CURRENCY, DATABASE, OWNERACCESS, ...). Aim for 1200+ candidates.` },
  { key: 'weird-shapes', prompt: `Candidates the exhaustive [a-z] scan CANNOT reach: words containing '_', '$', '#', or digits (ANY length), plus 7+ letter ordinary English/technical words. (a) 2000+ plausible underscored SQL words: CURRENT_*, SESSION_*, SYSTEM_*, SQL_*, ROW_*, *_NAME, *_CATALOG, *_SCHEMA, *_LENGTH, *_COUNT, *_TYPE, *_VALUE, *_LEVEL, *_USER, *_ROLE, *_PATH, *_SIZE, *_DATE, *_TIME, *_TIMESTAMP, GROUP_CONCAT, STRING_AGG, ARRAY_AGG, JSON_*, XML*, ST_*, DENSE_RANK, ROW_NUMBER, FIRST_VALUE, LAST_VALUE, NTH_VALUE, PERCENT_RANK, CUME_DIST, PERCENTILE_CONT, PERCENTILE_DISC, WITHIN_GROUP, TRANSACTIONS_COMMITTED, TRANSACTIONS_ROLLED_BACK, TRANSFORMS, USER_DEFINED_TYPE_CATALOG, PARAMETER_SPECIFIC_NAME, ROUTINE_SCHEMA, SPECIFIC_SCHEMA, SCOPE_NAME, STRAIGHT_JOIN, AUTO_INCREMENT, ... (b) words with digits: VARCHAR2, NVARCHAR2, INT2, INT4, INT8, FLOAT4, FLOAT8, BIT8, MD5, SHA1, SHA256, UTF8, LATIN1, CHAR2, RAW16, X509, DEC10, ISO8601, DB2 ... (c) words with '$' or '#': ROWID$, SYS$, TEMP#, DUAL$, ... (d) 2000+ general SQL/English technical words of length 7+ you have not covered elsewhere -- remember the short scan surprisingly found GO, LESS, MORE, ISSUE, PROTO, MUMPS, COBOL, ADA, PLI, SCN, UID, FTP, so include standards/language names, protocol names, and obscure vocabulary. Aim for 5000+ candidates total.` },
  { key: 'long-tail', prompt: `Long-tail systematic families (sqlparse's list is a concatenation of many dialect lists, so cast wide). Probe EVERY word you can generate from: (1) SQLSTATE/diagnostics vocabulary; (2) all standard scalar function names (ABS, ACOS, ASIN, ATAN, ATAN2, CEIL, CEILING, CHAR, CHARACTER, COALESCE, CONCAT, CONVERT, COS, COSH, COT, CURDATE, CURTIME, DATEADD, DATEDIFF, DATENAME, DATEPART, DAYNAME, DAYOFMONTH, DAYOFWEEK, DAYOFYEAR, DEGREES, EXP, EXTRACT, FLOOR, GREATEST, IFNULL, INITCAP, INSTR, LCASE, LEAST, LENGTH, LOCATE, LOG, LOG10, LOWER, LPAD, LTRIM, MOD, MONTHNAME, NULLIF, OVERLAY, POSITION, POWER, QUARTER, RADIANS, RAND, REPEAT, REPLACE, REVERSE, ROUND, RPAD, RTRIM, SIGN, SIN, SINH, SOUNDEX, SPACE, SQRT, SUBSTR, SUBSTRING, TAN, TANH, TRANSLATE, TRIM, TRUNC, UCASE, UPPER, WEEKDAY, ...); (3) transaction/isolation vocabulary; (4) privilege vocabulary; (5) constraint vocabulary; (6) storage/partitioning vocabulary; (7) cursor vocabulary; (8) trigger vocabulary; (9) XML/JSON vocabulary; (10) window-function vocabulary (RANK, DENSE_RANK, ROW_NUMBER, NTILE, LEAD, LAG, FIRST_VALUE, LAST_VALUE, NTH_VALUE, PERCENT_RANK, CUME_DIST, PRECEDING, FOLLOWING, UNBOUNDED, RESPECT, IGNORE, ...); (11) collation/charset names; (12) datatype vocabulary of every dialect. Aim for 3000+ candidates.` },
];

phase('Probe');

const specs = await pipeline(
  DIMENSIONS,
  d => agent(COMMON + '\n' + d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: SPEC_SCHEMA, effort: 'high' }),
  (s, d) => s == null ? null : agent(
    COMMON + `\n# Adversarial cross-check task\nAnother analyst produced the spec below for dimension "${d.key}".\n` +
    `Your job: try HARD to falsify it. Run at least 40 NEW probes chosen to break its claims, especially\n` +
    `boundary cases and interactions it glossed over. Then return a CORRECTED, merged spec (keep what\n` +
    `survived, fix what did not, add what was missing). Also verify every one of its testVectors literally\n` +
    `by running the executable and comparing byte-exactly; DROP or FIX any vector that does not reproduce.\n` +
    `Return the corrected spec plus the verified test vectors (aim to keep 40+).\n\n` +
    `--- ORIGINAL ASSIGNMENT ---\n${d.prompt}\n\n--- SPEC UNDER TEST ---\n` +
    JSON.stringify(s, null, 1).slice(0, 60000),
    { label: `verify:${d.key}`, phase: 'Crosscheck', schema: SPEC_SCHEMA, effort: 'high' }
  ),
);

phase('Keywords');

const kws = await parallel(KW_BUCKETS.map(b => () => agent(
  COMMON + `
# Task: harvest sqlparse's KEYWORD SET for one bucket
A word is a KEYWORD iff, run standalone, it comes back UPPERCASED. Test in BULK: build an array of
lowercase candidate words and probe them joined by ',' with NO spaces, e.g.
  /workspace/dataset/test4_executable --a 'alpha,beta,gamma'
then split the output on ',' and compare each element to the input word. Use ~2000 candidates per
invocation and ASSERT the split count equals the candidate count (if not, some word swallowed a
separator -- bisect and handle it individually; e.g. 'go' eats FOLLOWING whitespace, which is why we
use no spaces). Write a small node script under /tmp/probe/ to do this; run it; iterate.
ALREADY exhaustively determined by brute force over [a-z]: every word of length 1..6 composed only of
a-z letters is known. So do NOT waste candidates on those -- focus on length >= 7, and on words
containing '_', '$', '#' or digits (any length).
Bucket to cover: ${b.prompt}
Save confirmed keywords (lowercase, one per line) to /tmp/probe/kwlists/${b.key}.txt and report that path.
Also report SURPRISING non-keywords (words you were confident were keywords but are not).
Be exhaustive; more candidates is strictly better. Do at least 6 rounds of candidate generation, each
time brainstorming a fresh angle, until a round yields no new keywords.`,
  { label: `kw:${b.key}`, phase: 'Keywords', schema: KW_SCHEMA, effort: 'high' }
)));

return { specs: specs.filter(Boolean), keywordBuckets: kws.filter(Boolean) };
