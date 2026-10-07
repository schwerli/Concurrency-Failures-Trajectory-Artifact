export const meta = {
  name: 'sqlparse-split-port',
  description: 'Black-box port of Python sqlparse.split CLI to zero-dependency Node ESM, with differential fuzz hardening',
  phases: [
    { title: 'Probe', detail: 'parallel black-box discovery of sqlparse.split + argparse + repr behaviour' },
    { title: 'Spec', detail: 'synthesise one authoritative implementation spec' },
    { title: 'Build', detail: 'write the hierarchical .mjs library + entry point into /output' },
    { title: 'Harden', detail: 'differential fuzz rounds against the executable, fix until dry' },
    { title: 'Audit', detail: 'compliance audit + adversarial review' },
    { title: 'Regress', detail: 'final full-corpus regression' },
  ],
}

const RULES = `
HARD CONSTRAINTS for any code you write under /output (the graded deliverable):
- Pure JavaScript for Node.js 18, ES Modules ONLY. Use 'import'/'export'. NEVER 'require' or 'module.exports'.
- Every file under /output MUST use the .mjs extension, and every import MUST include the full
  './name.mjs' suffix.
- ZERO external dependencies. Only local relative imports are allowed. No npm packages. Importing
  node: builtins is permitted but should be unnecessary except possibly nothing at all.
- NO REGULAR EXPRESSIONS ANYWHERE. No regex literals, no 'new RegExp', no String.prototype
  match/matchAll/replace/replaceAll/search/split with a pattern. The tokenizer MUST be a
  hand-written character-by-character lexer.
- Additionally, do not lean on high-level String scanning helpers for the lexing logic
  (indexOf, includes, startsWith, endsWith, lastIndexOf, split, trim, toUpperCase, toLowerCase,
  normalize, localeCompare). Convert the input once with Array.from(text) into an array of
  code-point strings and drive the lexer off array indexing and '===' comparisons, with your own
  ASCII case folding and your own whitespace/strip helpers.
  Permitted primitives: Array.from, array indexing, String.prototype.codePointAt/charCodeAt for
  reading a character's numeric value, String.fromCodePoint/fromCharCode, Array.prototype.join,
  array/number/Map/Set operations.
- No Python. Never invoke 'python'. Never embed or shell out to Python.
- Do not unpack, decompile or read strings out of the executable. This is a strictly black-box
  reimplementation; the ONLY legitimate source of truth is running the executable.

Reference oracle and tooling (read /workspace/spec/FINDINGS.md FIRST — it is confirmed ground truth):
- node /workspace/harness/probe.mjs --inline '["sql a","sql b"]'   -> shows the executable's exact
  stdout/stderr/exit code, JSON-escaped, per input. Entries may also be raw argv arrays, e.g. [["-h"]].
- node /workspace/harness/probe.mjs /path/corpus.json
- node /workspace/harness/compare.mjs /path/corpus.json            -> differential test of
  /output/test2.mjs vs the executable; prints each mismatch; non-zero exit on failure.
- /workspace/corpus/*.json are JSON arrays of test inputs (string => argv ["--a", s]; array => raw argv).
Use probe.mjs/compare.mjs rather than raw shell invocations: it eliminates quoting errors.
`

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'reportPath', 'rules', 'openQuestions', 'corpusPath', 'caseCount'],
  properties: {
    area: { type: 'string' },
    reportPath: { type: 'string', description: 'markdown report you wrote under /workspace/spec/' },
    corpusPath: { type: 'string', description: 'JSON corpus of the inputs you probed, under /workspace/corpus/' },
    caseCount: { type: 'integer' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules you CONFIRMED, each with the evidence that proves it',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence'],
        properties: {
          rule: { type: 'string' },
          evidence: { type: 'string', description: 'input -> exact observed output' },
        },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}

const AREAS = [
  {
    slug: 'begin-end-levels',
    title: 'BEGIN/END/CASE/IF/DECLARE/CREATE nesting semantics',
    detail: `Nail the statement-splitter state machine exactly. Determine:
- the complete set of multi-word BEGIN forms that lex as a single keyword token (probe
  TRANSACTION, WORK, DEFERRED, IMMEDIATE, EXCLUSIVE, ATOMIC, TRAN, DEFERRED TRANSACTION,
  IMMEDIATE TRANSACTION, EXCLUSIVE TRANSACTION, "BEGIN  TRANSACTION" with extra/newline
  whitespace, "BEGIN TRANSACTION_X", lower/mixed case, and whether a trailing word is required).
- the complete set of multi-word END forms (END IF, END LOOP, END WHILE, END FOR, END CASE,
  END TRY, extra whitespace, newline between, case-insensitivity).
- the complete set of CREATE forms that set isCreate (CREATE, CREATE OR REPLACE,
  CREATE OR ALTER, "CREATE  OR  REPLACE" with odd whitespace/newlines, lowercase).
- exactly when DECLARE raises the level, and what inDeclare affects (if anything observable).
- exactly when IF / FOR / WHILE / CASE raise the level, and the inCase interaction with END.
  Include deep nesting, unbalanced END, END without BEGIN, many nested BEGINs, CASE outside
  CREATE, CASE inside CREATE...BEGIN, IF outside a BEGIN block, LOOP/WHILE bodies.
- verify the exact BEGIN pre-scan rule from FINDINGS.md against more shapes: BEGIN followed by
  a hint comment, nested comments, an unterminated comment, EOF, ')' , ',' , '(' , '::' , GO.
Use the level-measuring trick: append ')' characters to observe the numeric level, and use a
trailing '; SELECT 1;' probe to detect whether a split happened.`,
  },
  {
    slug: 'strings-quoting',
    title: 'String literals, quoted identifiers, dollar quoting, escapes',
    detail: `Determine byte-exact rules for hiding ';' inside quoted constructs:
- single quotes with '' doubling and backslash escapes; the backtracking behaviour when a
  literal cannot otherwise terminate (see FINDINGS.md); multiple backslashes ('a\\\\\\\\'),
  '\\\\' at end, ''' , '''' , odd numbers of quotes.
- double quotes, backticks, the acute-accent quoting (U+00B4), and whether doubling and
  backslash escapes apply to each.
- [bracket] quoting incl. the preceding-character restriction, nested brackets, ']' inside,
  '[' after ')' or ']' or a digit or an underscore.
- dollar quoting: $$..$$, $tag$..$tag$, mismatched tags, $1 placeholders, $ after a word
  character or a '"' or a '$', unterminated dollar quotes, tags with digits/underscores.
- prefixed literals E'..', N'..', B'..', X'..', U&'..', e'..', and whether the prefix merges
  with the literal token.
- unterminated literals of every kind, and literals containing newlines.
Report which constructs successfully hide ';' and which do not.`,
  },
  {
    slug: 'comments',
    title: 'Comment lexing and the consume-whitespace absorption rule',
    detail: `Determine exactly:
- '--' comments (with/without following space, '--+' hint comments, at EOF without newline,
  \\r\\n vs \\r vs \\n line endings, whether the terminating newline is part of the token).
- '#' comments: confirm the required following space; test '#', '# ', '#\\t', '#x', '##x', '#1'.
- '/* */' comments: nesting attempts, '/*+' hint comments, unterminated, containing ';' and
  quotes, '/**/', '/*/', multiple on one line.
- the absorption rule after a ';' (and after GO): which token types are absorbed into the
  finished statement vs. which start the next one. Specifically prove the newline-vs-space
  distinction, tab, \\r, \\f, \\v, form feeds, multiple blank lines, a '--' comment after a
  newline, a '/* */' comment after spaces, and a comment immediately followed by EOF.
- how a hint comment ('--+ x', '/*+ x */') behaves in the absorption rule (its token type may
  differ from a plain comment, which would change whether it is absorbed).`,
  },
  {
    slug: 'go-splitter',
    title: 'The GO batch separator',
    detail: `Determine the complete rule for GO as a statement splitter:
- case sensitivity (GO, go, Go, gO), word boundaries (GO2, GOTO, XGO, GO_1, "GO;"),
- the numeric-count form: 'GO 2', 'GO 10', 'GO  2' (two spaces), 'GO\\t2', 'GO\\n2', 'GO 2 3',
  'GO -2', 'GO 2x'. Establish whether the count is part of the same token and what the emitted
  statement text is.
- whether GO splits at nonzero paren level and inside a BEGIN block (FINDINGS.md says yes for
  both — confirm and look for exceptions).
- what happens with GO at the very start, GO alone, 'GO GO', 'GO;', ';GO;', GO inside a string
  or comment, GO immediately after '(' , GO followed by EOF.
- whether GO resets the splitter state (test: does a BEGIN block opened before GO still
  suppress a later ';'?).
- interaction with the absorption rule (what stays attached to the statement after GO).`,
  },
  {
    slug: 'keyword-vs-name',
    title: 'When an identifier is a keyword vs a plain name',
    detail: `The level logic only fires for keyword-typed tokens, so determine exactly when the
lexer downgrades an identifier to a name. Probe with BEGIN/END/CASE/IF (words that change the
level) as the payload so the effect is observable:
- immediately followed by '(' , or by whitespace then '(' , or by '\\n(' ;
- immediately preceded by '.' , followed by whitespace then '.' , 'a . begin' with spaces;
- quoted forms: "BEGIN", \`BEGIN\`, [BEGIN], 'BEGIN';
- prefixed forms: @BEGIN, #BEGIN, ##BEGIN, :BEGIN, $BEGIN, ?BEGIN, \\BEGIN;
- glued forms: BEGINX, XBEGIN, BEGIN1, BEGIN_, _BEGIN, BEGIN$, BEGIN#;
- case variants and non-ASCII identifier characters (accented letters such as À-Ü and their
  lowercase forms, other Unicode letters, digits, '$' and '#' inside identifiers).
Also determine whether ':=' , '::' , '*' , placeholders ('?', '%s', '%(name)s', ':name', '$1')
affect anything, and confirm that ';' inside such a token cannot occur.`,
  },
  {
    slug: 'whitespace-strip',
    title: 'Whitespace classification, statement stripping, empty statements',
    detail: `Determine exactly:
- which characters count as lexer whitespace vs. the distinct newline token: space, \\t, \\n,
  \\r, \\r\\n, \\f, \\v, U+00A0, U+2000, U+3000, U+200B, U+2028, U+2029, U+0085.
  Use the absorption rule after ';' as the observable (whitespace is absorbed, a newline token
  is not) and report the classification per character.
- exactly which characters Python's str.strip() removes from each statement (test a statement
  padded with each of the above characters and see what survives in the output).
- the empty/whitespace-only statement suppression rule: '', '   ', '\\n', ';', ';;', ' ; ; ',
  '; \\n ;', a trailing ';' with trailing whitespace/newlines/comments, input that is only a
  comment, only whitespace plus a comment, only ';'.
- whether a statement that strips to '' can ever be emitted (probe hard: e.g. ';\\n;', '; ;',
  and inputs where the final chunk is only a newline or only a comment).`,
  },
  {
    slug: 'python-repr',
    title: 'Python list/str repr formatting of the printed result',
    detail: `The program prints the repr of a list of str. Determine the exact formatting for
every character class, by feeding single-statement inputs containing the character and reading
the printed form:
- quote selection: no quotes, only ', only ", both ' and ", '' only, backslashes.
- escapes: backslash, \\n, \\r, \\t, \\x00, \\x07, \\x08, \\x0b, \\x0c, \\x1b, \\x7f, \\x80-\\x9f,
  U+00A0, U+00AD, U+061C, U+200B, U+200E, U+2028, U+2029, U+3000, U+FEFF, U+FFFD.
- printable non-ASCII kept literally: accented Latin, Greek, CJK (e.g. Chinese), Cyrillic,
  emoji / astral plane characters (U+1F600), U+10FFFF, and characters near the BMP boundary.
- surrogate / lone-surrogate handling if reachable, and NUL handling.
Note the CLI cannot receive a NUL byte via argv; use the shape of neighbouring results to infer
it, and say so. Produce a precise, implementable specification of the escape algorithm
(including when Python uses \\xNN vs \\uXXXX vs \\UXXXXXXXX), and enumerate the Unicode ranges
that must be treated as non-printable, restricted to what you could actually confirm plus the
documented Python rule (non-printable = Unicode categories Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs
except the ASCII space). Give a compact, complete table for the ranges you confirmed and flag
which ranges an implementation can safely approximate.`,
  },
  {
    slug: 'cli-argparse',
    title: 'argparse-compatible CLI behaviour',
    detail: `Determine byte-exact stdout/stderr/exit-code behaviour for:
- no args; --a with no value; --a=VALUE; --a VALUE; repeated --a (last wins?); -h; --help;
  --a and -h together in both orders; unknown option --b; unknown positional; '--' separator;
  a value that begins with '-' or '--' (e.g. --a -x, --a=--x, --a "-;-"); '--a=' (empty value);
  abbreviation forms (--, -a, --A, --aa); a value containing newlines/spaces/unicode.
- capture the EXACT usage/help/error text and which stream it goes to, and the exit codes.
- note that the harness normalises the program name, so record where the program name appears.
Write the exact texts into your report, with escapes, so they can be reproduced character for
character.`,
  },
  {
    slug: 'realistic-sql',
    title: 'Realistic multi-statement SQL of the kind the grader will use',
    detail: `The graded test cases look like the four samples in the source file: several
realistic SQL statements on one line separated by '; ', sometimes without a trailing semicolon.
Probe a broad, realistic corpus (at least 120 inputs) across: SELECT with joins/subqueries/CTEs
(WITH ... AS (...)), window functions, CASE expressions, INSERT with multiple VALUES tuples,
UPDATE ... SET, DELETE, TRUNCATE, CREATE TABLE with constraints and nested parens, CREATE INDEX,
CREATE VIEW AS SELECT, CREATE TRIGGER ... BEGIN ... END, CREATE PROCEDURE/FUNCTION bodies,
ALTER TABLE variants, DROP, GRANT, SET, transactions (BEGIN/COMMIT/ROLLBACK/SAVEPOINT),
MERGE, UPSERT/ON CONFLICT, EXPLAIN, PRAGMA, multi-line formatted SQL with newlines and
indentation, statements with inline comments, string literals containing semicolons and quotes,
JSON operators (->, ->>, #>), casts (::), array indexing, and dialect quirks.
Record every input whose output is surprising (statements NOT split at a ';', or split in an
unexpected place) — these are the highest-value cases. Save the whole corpus as JSON.`,
  },
  {
    slug: 'adversarial-structure',
    title: 'Adversarial and degenerate inputs',
    detail: `Hunt for behaviour that a naive implementation would get wrong. Probe: very many
consecutive semicolons; semicolons inside every kind of quoting; unbalanced parens in both
directions (deep negatives then positives); ')' before '(' then a ';'; '(' ... EOF; interleavings
of BEGIN/END/CASE/IF/CREATE with unbalanced parens; a ';' inside an unterminated string followed
by more text; a comment that never terminates; input ending mid-token; ';' as the very first
character; input of only punctuation; ':=' and '::' next to ';'; '*/' without an opener;
'--' at EOF; '#' at EOF; a lone '$'; a lone backslash; '\\\\g' style commands; 'GO' variants next
to ';'; CREATE ... BEGIN with no END at EOF; nested CREATE inside a BEGIN block; a second CREATE
after a split; state leakage across statements (does isCreate/beginDepth reset after a split?
prove it); and long inputs (thousands of statements) for both correctness and performance.
Report every case where the outcome is counter-intuitive, with exact evidence.`,
  },
]

phase('Probe')
const probes = await parallel(
  AREAS.map((a) => () =>
    agent(
      `You are reverse-engineering the behaviour of a Python CLI (Python's sqlparse.split) so it can be
reimplemented in Node.js. You are in the DISCOVERY phase: you write NO implementation code.
Your job is to produce an exhaustive, precise, evidence-backed behavioural specification for ONE area.

AREA: ${a.title}

${a.detail}

${RULES}

Method:
1. Read /workspace/spec/FINDINGS.md first. It is confirmed ground truth — build on it, extend it,
   and challenge anything you can disprove (if you disprove something, say so loudly with evidence).
2. Probe with node /workspace/harness/probe.mjs --inline '[...]' in batches of 10-40 inputs.
   Iterate: form a hypothesis, design an input that DISCRIMINATES between competing hypotheses,
   run it, refine. Do not stop at "it works"; find the boundary of every rule.
3. When a rule is about the splitter's internal counters, use observable probes: append ')' to
   measure the level, and append '; SELECT 1;' to detect whether a split happens.
4. Save every input you probed as a JSON array to /workspace/corpus/probe-${a.slug}.json
   (string entries mean argv ["--a", s]; array entries are raw argv). This becomes a regression
   corpus, so include the interesting cases, not just the boring ones. Aim for 80+ cases.
5. Write a detailed markdown report to /workspace/spec/probe-${a.slug}.md containing: the
   confirmed rules stated in implementable pseudocode, a table of evidence (input -> exact output),
   the hypotheses you eliminated, and any remaining uncertainty.

Precision matters far more than breadth of prose. Every rule you state must be backed by an
input/output pair you actually observed. Return the structured summary.`,
      { label: `probe:${a.slug}`, phase: 'Probe', schema: PROBE_SCHEMA },
    ),
  ),
)

const goodProbes = probes.filter(Boolean)
log(`Probe phase done: ${goodProbes.length}/${AREAS.length} reports, ` +
    `${goodProbes.reduce((n, p) => n + (p.caseCount || 0), 0)} probed cases, ` +
    `${goodProbes.reduce((n, p) => n + (p.rules?.length || 0), 0)} confirmed rules, ` +
    `${goodProbes.reduce((n, p) => n + (p.openQuestions?.length || 0), 0)} open questions`)

phase('Spec')
const openQs = goodProbes.flatMap((p) => (p.openQuestions || []).map((q) => `- [${p.area}] ${q}`)).join('\n')

const spec = await agent(
  `You are writing the single authoritative implementation spec for a black-box Node.js port of a
Python CLI that prints \`repr(sqlparse.split(args.a))\`.

Inputs to read (all of them, fully):
- /workspace/spec/FINDINGS.md  (confirmed ground truth)
- every /workspace/spec/probe-*.md report

${RULES}

Open questions left by the discovery agents:
${openQs || '(none reported)'}

Your job:
1. Read everything. Where two reports disagree, RESOLVE the conflict by running
   node /workspace/harness/probe.mjs yourself, and record the verdict with evidence.
2. Resolve as many of the open questions above as you can the same way.
3. Write /workspace/spec/SPEC.md: a complete, self-contained, unambiguous implementation spec,
   detailed enough that an engineer who has never seen the executable can reproduce it exactly.
   It MUST contain:
   a. The character classification tables (whitespace vs newline, word characters, digits,
      letters incl. the accented ranges).
   b. The complete ordered token-rule list for the hand-written lexer: for each rule, the exact
      matching condition in prose/pseudocode (NOT as a regex), the emitted token type, and the
      exact token text. Order matters — state it as a priority list, and call out the rules whose
      relative order is behaviourally observable.
   c. The token type hierarchy needed by the splitter (which types count as keyword, which count
      as whitespace-proper, which count as a newline, which count as a single-line comment) and
      the subtype containment test.
   d. The keyword tables: every word whose keyword-ness is observable by the splitter, plus the
      multi-word forms, plus how case folding works.
   e. The statement splitter state machine in exact step order, including the BEGIN pre-scan
      rule, the GO rule, the absorption rule, the level/beginDepth/inCase/inDeclare/isCreate
      transitions, the split condition, the end-of-input rule, and the whitespace-only
      suppression rule.
   f. Python str.strip() semantics and the exact set of stripped characters.
   g. The Python repr algorithm for str and for list-of-str, including quote selection, the
      escape table, and the printability ranges (with a note on which ranges may be approximated
      and why that is safe).
   h. The argparse-compatible CLI contract: exact stdout/stderr text and exit codes for every
      form, and the argument parsing algorithm.
   i. A recommended module decomposition for /output (see below) and which spec section each
      module implements.
4. Also write /workspace/corpus/spec-golden.json: a curated JSON corpus of at least 200 inputs
   that together exercise EVERY rule in the spec, biased toward the rules that are easy to get
   wrong and toward realistic multi-statement SQL like the graded samples.

Required module decomposition for /output (hierarchical, ESM, .mjs):
  /output/lib/chars.mjs      character classification + case folding + strip helpers
  /output/lib/tokens.mjs     token type constants and the containment test
  /output/lib/keywords.mjs   keyword tables, multi-word forms, lookup
  /output/lib/lexer.mjs      the hand-written tokenizer
  /output/lib/splitter.mjs   the statement splitter state machine
  /output/lib/sqlparse.mjs   split() facade (tokenize -> split -> strip)
  /output/lib/pyrepr.mjs     Python str/list repr
  /output/lib/cli.mjs        argparse-compatible argv parsing
  /output/test2.mjs          entry point

Return a concise summary: the spec path, the corpus path and case count, the conflicts you
resolved, and anything still genuinely unknown.`,
  { label: 'spec:synthesise', phase: 'Spec' },
)

phase('Build')
const build = await agent(
  `Implement the Node.js port now, into /output.

Read, fully, in this order:
- /workspace/spec/SPEC.md   (your primary contract)
- /workspace/spec/FINDINGS.md
- the /workspace/spec/probe-*.md reports for any detail the spec leaves ambiguous

${RULES}

Deliverables — exactly this hierarchy, all ESM, all .mjs, every import carrying its .mjs suffix:
  /output/lib/chars.mjs      character classification + ASCII case folding + Python strip helpers
  /output/lib/tokens.mjs     token type constants + subtype containment test
  /output/lib/keywords.mjs   keyword tables + multi-word keyword forms + lookup
  /output/lib/lexer.mjs      hand-written character-by-character tokenizer
  /output/lib/splitter.mjs   statement splitter state machine
  /output/lib/sqlparse.mjs   split() facade
  /output/lib/pyrepr.mjs     Python str/list repr
  /output/lib/cli.mjs        argparse-compatible argv parsing (manual process.argv handling)
  /output/test2.mjs          entry point: parse --a, call split, print the repr

Requirements:
- /output/test2.mjs must behave identically to
  /workspace/dataset/test2_executable --a VALUE : same stdout bytes, same stderr bytes (modulo the
  program name), same exit code.
- Each module must export a clean interface; the entry point must stay thin.
- Write real code, not stubs. Handle every rule in the spec. Comment the non-obvious parts,
  especially anywhere you emulate a regex's backtracking behaviour by hand.
- Performance: the lexer must be linear-ish; inputs of thousands of statements must finish fast.

Verify before you finish:
1. node /workspace/harness/compare.mjs /workspace/corpus/seed.json
2. node /workspace/harness/compare.mjs /workspace/corpus/spec-golden.json
3. every other /workspace/corpus/*.json file
Fix everything that fails, and iterate until all of these pass. Do not report success unless the
compare runs actually exit zero — quote the final RESULT lines in your answer.

Return: the files you wrote, the final RESULT line of each compare run, and any case you could
not make pass (with the exact input and both outputs).`,
  { label: 'build:implement', phase: 'Build' },
)
log(`Build phase complete.`)

const FUZZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['casesRun', 'mismatchCount', 'corpusPath', 'mismatches'],
  properties: {
    casesRun: { type: 'integer' },
    mismatchCount: { type: 'integer' },
    corpusPath: { type: 'string', description: 'JSON corpus you generated (all cases)' },
    failingCorpusPath: { type: 'string', description: 'JSON corpus containing ONLY the failing cases, or empty string' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'expected', 'actual', 'diagnosis'],
        properties: {
          input: { type: 'string', description: 'JSON-escaped argv or --a value' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          diagnosis: { type: 'string', description: 'which rule/module is wrong, and why' },
        },
      },
    },
  },
}

const FUZZ_LENSES = [
  { slug: 'realistic', focus: `Realistic multi-statement SQL like the graded samples: DDL, DML, joins, CTEs, window functions, INSERT with many VALUES tuples, ALTER TABLE variants, CREATE VIEW/INDEX/TRIGGER/PROCEDURE, transactions, MERGE/UPSERT, GRANT, EXPLAIN, PRAGMA, SET. Vary: trailing semicolon present/absent, single-line vs multi-line with indentation, inline comments, string literals containing ';' and quotes.` },
  { slug: 'quoting', focus: `Every quoting construct and its interaction with ';': single/double/backtick/acute/bracket quoting, doubled quotes, backslash escapes and the backtracking corner cases, dollar quoting with and without tags, prefixed literals (E/N/B/X/U&), unterminated literals, literals spanning newlines, adjacent literals, literals next to comments.` },
  { slug: 'comments', focus: `Every comment form and the absorption rule: '--' and '# ' comments with all line endings and at EOF, hint comments ('--+', '/*+'), block comments containing ';', quotes and '*/'-lookalikes, unterminated block comments, comments immediately after ';' with and without preceding spaces/newlines/tabs, several comments in a row, comment-only inputs.` },
  { slug: 'blocks', focus: `BEGIN/END/CASE/IF/FOR/WHILE/DECLARE/CREATE nesting: every multi-word BEGIN and END form, CREATE and CREATE OR REPLACE, procedure/trigger/function bodies, deep nesting, unbalanced END, missing END at EOF, CASE inside and outside CREATE, the BEGIN pre-scan rule against comments and EOF, state reset across statements.` },
  { slug: 'go-and-punct', focus: `The GO separator in every form and position (case variants, 'GO n', nesting, next to ';', inside strings/comments, at EOF), plus punctuation and operator edge cases: '::', ':=', '*', placeholders, '->', '->>', '#>', array indexing, unbalanced parens in both directions, ';' as first/last character, runs of ';'.` },
  { slug: 'whitespace-unicode', focus: `Whitespace and Unicode: space/tab/\\n/\\r/\\r\\n/\\f/\\v/U+00A0/U+2000/U+3000/U+200B/U+2028/U+2029/U+0085 in and around ';', leading/trailing padding of every kind, whitespace-only and empty inputs, and non-ASCII payloads (CJK, Cyrillic, accented Latin, emoji/astral, U+FEFF, U+FFFD) that stress both the lexer and the Python repr escaping.` },
  { slug: 'repr', focus: `The printed Python repr: strings containing single quotes, double quotes, both, backslashes, control characters, tabs and newlines, non-printable Unicode, astral characters; single vs many statements; the empty list; and statements whose text ends with a backslash or a quote.` },
  { slug: 'cli-and-degenerate', focus: `CLI forms (raw argv array entries): no args, --a alone, --a=, --a=VALUE, repeated --a, -h, --help, unknown options, positionals, '--' separator, values starting with '-', plus degenerate SQL payloads: only punctuation, lone '$', lone backslash, '*/' with no opener, input ending mid-token, and very large inputs (thousands of statements) to check both correctness and speed.` },
]

phase('Harden')
let round = 0
let dryRounds = 0
const roundLog = []
while (round < 6 && dryRounds < 2) {
  round++
  const rn = round
  const results = (await parallel(
    FUZZ_LENSES.map((lens) => () =>
      agent(
        `You are a differential-testing agent (round ${rn}) hunting for behavioural differences between
the reference Python executable and the Node port at /output/test2.mjs.

YOUR LENS: ${lens.focus}

${RULES}

Method:
1. Skim /workspace/spec/SPEC.md for the rules relevant to your lens, and check
   /workspace/corpus/ for what previous rounds already covered — you are looking for NEW ground.
   ${rn > 1 ? 'Earlier rounds already found and fixed bugs; go deeper and weirder than an obvious first pass would.' : ''}
2. Generate a LARGE corpus for your lens — at least 250 inputs, ideally 500+. Write a small
   Node generator script under /tmp/ that composes fragments combinatorially (no Python), and
   have it emit /workspace/corpus/fuzz-r${rn}-${lens.slug}.json as a JSON array. Include both
   systematic combinations and hand-crafted nasty cases.
3. Run: node /workspace/harness/compare.mjs /workspace/corpus/fuzz-r${rn}-${lens.slug}.json
4. For each mismatch, minimise it to the smallest input that still differs, and diagnose which
   spec rule and which /output module is wrong. Do NOT edit anything under /output — you are a
   detector, not a fixer.
5. Write the minimised failing cases (only those) as a JSON array to
   /workspace/corpus/fail-r${rn}-${lens.slug}.json. If there are none, do not create the file
   and return failingCorpusPath as an empty string.

Report at most 25 distinct mismatches, most important first, each with the exact input, the
expected output, the actual output, and your diagnosis. Return the structured result.`,
        { label: `fuzz-r${rn}:${lens.slug}`, phase: 'Harden', schema: FUZZ_SCHEMA },
      ),
    ),
  )).filter(Boolean)

  const totalCases = results.reduce((n, r) => n + (r.casesRun || 0), 0)
  const totalMismatch = results.reduce((n, r) => n + (r.mismatchCount || 0), 0)
  const failPaths = results.map((r) => r.failingCorpusPath).filter((p) => p && p.length > 0)
  roundLog.push({ round: rn, totalCases, totalMismatch })
  log(`Harden round ${rn}: ${totalCases} cases, ${totalMismatch} mismatches across ${results.length} lenses`)

  if (totalMismatch === 0) {
    dryRounds++
    log(`Round ${rn} was clean (${dryRounds} consecutive clean round${dryRounds > 1 ? 's' : ''}).`)
    continue
  }
  dryRounds = 0

  const details = results
    .filter((r) => (r.mismatchCount || 0) > 0)
    .map((r) =>
      `### lens ${r.corpusPath}\nfailing corpus: ${r.failingCorpusPath || '(none written)'}\n` +
      (r.mismatches || [])
        .map((m) => `- input: ${m.input}\n  expected: ${m.expected}\n  actual:   ${m.actual}\n  diagnosis: ${m.diagnosis}`)
        .join('\n'),
    )
    .join('\n\n')

  await agent(
    `You are fixing the Node port at /output so it matches the reference executable exactly.
Round ${rn} of differential fuzzing found ${totalMismatch} mismatches.

${RULES}

Mismatches found (already minimised and diagnosed by the detectors):

${details}

Failing-case corpora to use as your fix targets:
${failPaths.map((p) => '- ' + p).join('\n') || '(none)'}

Method:
1. Reproduce each failure with node /workspace/harness/compare.mjs <failing corpus>.
2. For each one, work out the TRUE rule by probing the oracle
   (node /workspace/harness/probe.mjs --inline '[...]') — do not guess, and do not special-case
   individual inputs. Fix the underlying rule in the right module. A fix that pattern-matches a
   specific test string is a bug, not a fix.
3. If the spec (/workspace/spec/SPEC.md) is wrong or silent, update the spec too so it stays the
   source of truth.
4. Re-run, in this order, until all exit zero:
   - every /workspace/corpus/fail-*.json
   - /workspace/corpus/seed.json
   - /workspace/corpus/spec-golden.json
   - every other /workspace/corpus/*.json  (regression: earlier fixes must not have broken)
   A quick way to run them all: for f in /workspace/corpus/*.json; do node /workspace/harness/compare.mjs "$f" --quiet; done
5. Keep the hard constraints intact: no regex, no external imports, ESM, .mjs.

Return: the root cause of each mismatch class, the modules you changed, and the final RESULT
line for every corpus file (state plainly if anything still fails).`,
    { label: `fix-r${rn}`, phase: 'Harden' },
  )
}

log(`Harden phase finished after ${round} round(s): ` + roundLog.map((r) => `r${r.round}=${r.totalMismatch}`).join(' '))

phase('Audit')
const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['clean', 'issues'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'issue', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const audits = (await parallel([
  () =>
    agent(
      `Audit /output for COMPLIANCE with the task's hard requirements. Be pedantic and exhaustive;
this is a graded checklist.

Check every file under /output:
1. ES Modules only. No 'require(', no 'module.exports', no '__dirname'/'__filename' misuse,
   no CommonJS anywhere. Use grep to prove it.
2. Every file ends in .mjs, and EVERY import specifier is relative and includes the .mjs suffix.
   Verify each import actually resolves (node --check each file, and node -e 'import(...)').
3. Zero external dependencies: no bare-specifier imports at all (no npm packages). Local
   relative imports only. Flag any 'node:' import and judge whether it is truly needed for the
   entry point (reading process.argv and writing stdout does not need one).
4. NO regular expressions anywhere: no regex literals, no 'new RegExp', no .match/.matchAll/
   .replace/.replaceAll/.search/.test/.exec, no String.split with a pattern. Also flag the
   discouraged high-level String scanning helpers used in lexing logic (indexOf, includes,
   startsWith, endsWith, split, trim, toUpperCase, toLowerCase) — the lexer must be a
   hand-written character loop over Array.from(text).
5. No Python: no 'python' string, no child_process, no spawn/exec anywhere.
6. Hierarchical organisation: multiple modules split by functionality, each exporting a clean
   interface, with a thin entry point at /output/test2.mjs.
7. No stray/dead files, no leftover scratch or test files that do not belong in the deliverable,
   no absolute paths baked in, no reads of /workspace at runtime.
8. The entry point runs correctly from any cwd: test 'cd /tmp && node /output/test2.mjs --a "SELECT 1; SELECT 2"'.

Report each violation with the file, the offending line, and the concrete fix. Do NOT edit files.
Return the structured verdict.`,
      { label: 'audit:compliance', phase: 'Audit', schema: AUDIT_SCHEMA },
    ),
  () =>
    agent(
      `Adversarially review the correctness of the implementation in /output against
/workspace/spec/SPEC.md and the reference executable.

${RULES}

You are looking for rules that are implemented ALMOST right — the kind of bug fuzzing misses
because no generated input happened to hit it. Read every module in /output line by line and,
for each rule, construct the specific input that would expose an error, then run it through
node /workspace/harness/probe.mjs and node /output/test2.mjs and compare.

Pay particular attention to:
- the ordering of the lexer's token rules (a wrong order is invisible until one specific input),
- the hand-rolled emulation of regex backtracking in string literals,
- off-by-one and boundary conditions at end-of-input for every construct,
- the BEGIN pre-scan, the GO rule, and the absorption rule interacting with each other,
- state reset between statements (isCreate / beginDepth / inCase / inDeclare / level / consumeWs),
- the Python repr escape table and printability boundaries,
- CLI parsing edge cases and exit codes,
- any place the code takes a shortcut that happens to pass the existing corpora.

Write every input you found that differs into /workspace/corpus/audit-correctness.json (JSON
array) — even if you also report it. Do NOT edit /output. Report each real difference with
severity, file, the failing input, and the fix. Return the structured verdict.`,
      { label: 'audit:correctness', phase: 'Audit', schema: AUDIT_SCHEMA },
    ),
  () =>
    agent(
      `Review /output for code quality and robustness, as a senior reviewer would before merge.
Do NOT edit files; report findings.

${RULES}

Assess:
- Does the module decomposition make sense, with clear single responsibilities and no circular
  imports? Is the entry point thin?
- Is anything duplicated that should be shared? Is there dead code, unused exports, unreachable
  branches, or leftover debugging?
- Are the non-obvious parts (backtracking emulation, token rule order, printability ranges)
  explained by comments that would let a maintainer follow them?
- Robustness: extremely long input (build a 200k-character input with thousands of statements
  and time it — report the wall time), deeply nested parens, input that is one giant string
  literal, pathological comment nesting. Any quadratic blow-up or stack overflow (recursion!)
  is a blocker. Measure, do not speculate.
- Does it crash or throw on any input? A thrown exception where the executable prints a list is
  a blocker. Try hard to make it throw.
Return the structured verdict.`,
      { label: 'audit:quality', phase: 'Audit', schema: AUDIT_SCHEMA },
    ),
])).filter(Boolean)

const allFindings = audits.flatMap((a) => a.findings || [])
const blocking = allFindings.filter((f) => f.severity !== 'minor')
log(`Audit: ${allFindings.length} findings (${blocking.length} blocker/major)`)

if (allFindings.length > 0) {
  await agent(
    `Apply the audit findings to /output.

${RULES}

Findings from three independent auditors (blockers and majors first — fix all of them; fix the
minors too unless a fix would risk behavioural drift, and say so if you skip one):

${allFindings
  .map((f) => `- [${f.severity}] ${f.file}: ${f.issue}\n  suggested fix: ${f.fix}`)
  .join('\n')}

For every finding, first confirm it against the oracle
(node /workspace/harness/probe.mjs --inline '[...]') before changing behaviour — an auditor may
have misread the reference behaviour. If a finding is wrong, say so with evidence instead of
"fixing" it.

Then re-verify everything:
  for f in /workspace/corpus/*.json; do node /workspace/harness/compare.mjs "$f" --quiet; done
Every single file must report 0 failed. Also re-run the compliance greps (no regex, no require,
no bare imports, .mjs suffixes everywhere) after your edits.

Return: what you changed, what you rejected and why, and the full list of RESULT lines.`,
    { label: 'audit:apply', phase: 'Audit' },
  )
}

phase('Regress')
const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['allPassed', 'totalCases', 'totalFailures', 'corpusResults', 'complianceOk', 'notes'],
  properties: {
    allPassed: { type: 'boolean' },
    totalCases: { type: 'integer' },
    totalFailures: { type: 'integer' },
    corpusResults: { type: 'array', items: { type: 'string' } },
    complianceOk: { type: 'boolean' },
    fileList: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const final = await agent(
  `Final gate. Verify the deliverable in /output is complete, compliant and byte-exact.

${RULES}

Do all of this and report facts, not reassurance:
1. Run every corpus: for f in /workspace/corpus/*.json; do node /workspace/harness/compare.mjs "$f" --quiet; done
   Collect each RESULT line. Sum the cases and the failures.
2. Run the four official sample cases from /workspace/dataset/test2.py verbatim through both
   programs and confirm byte-identical stdout.
3. Generate one final fresh random corpus of 400+ mixed inputs (a Node generator under /tmp,
   no Python), covering realistic SQL plus every edge class in /workspace/spec/SPEC.md, save it
   as /workspace/corpus/final-gate.json, and run compare on it.
4. Compliance greps over /output: no 'require(', no 'module.exports', no bare-specifier imports,
   no regex literals or RegExp/match/replace/test/exec/split-with-pattern, no 'python', no
   child_process; all files .mjs; all imports carry .mjs; node --check passes on every file.
5. Confirm 'cd /tmp && node /output/test2.mjs --a "SELECT 1; SELECT 2"' works, and that
   'node /output/test2.mjs' with no args prints the argparse error to stderr with exit code 2.
6. List the final file tree of /output.

If ANYTHING fails, fix it (you may edit /output), then re-verify from step 1. Only report
allPassed: true if the final run genuinely had zero failures across every corpus.
Return the structured result.`,
  { label: 'regress:final-gate', phase: 'Regress' },
)

return {
  probes: goodProbes.map((p) => ({ area: p.area, rules: p.rules?.length || 0, cases: p.caseCount })),
  spec: spec ? 'written' : 'missing',
  hardenRounds: roundLog,
  auditFindings: allFindings.length,
  blockingFindings: blocking.length,
  final,
}
