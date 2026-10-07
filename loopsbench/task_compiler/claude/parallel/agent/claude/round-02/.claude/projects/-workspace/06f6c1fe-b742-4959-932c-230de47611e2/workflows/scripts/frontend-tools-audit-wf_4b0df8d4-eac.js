export const meta = {
  name: 'frontend-tools-audit',
  description: 'Exhaustive multi-lens audit of the finished lexical analyzer + LL(1) parser against all 27 requirements',
  phases: [
    { title: 'Audit', detail: 'independent finder lenses over the two source files' },
    { title: 'Verify', detail: 'adversarially refute each finding' },
    { title: 'Coverage', detail: 'requirement-clause coverage critic' },
  ],
}

const CONTEXT = `
Project: /workspace — two C++ compiler-lab front-end tools that were just finished.
  /workspace/LexicalAnalyzer/LexicalAnalysis.cpp   (lexer, complete)
  /workspace/Parser/SyntacticParser.cpp            (LL(1) parser, complete)
  /workspace/requirements/*.yaml                   (27 requirements, one per module)
  /workspace/agent_tests/run_lex.sh                (builds+runs the lexer in a scratch dir)
  /workspace/agent_tests/run_parser.sh <grammar> <input>  (builds+runs the parser; grammar copied to test3.txt, input piped on stdin)
  /workspace/agent_tests/test_parser_units.cpp     (unit tests: g++ -std=c++11 -Wall -o /tmp/pu agent_tests/test_parser_units.cpp && /tmp/pu)
  /workspace/LexicalAnalyzer/processed.txt and afterPreProcess.txt are GBK-encoded REFERENCE outputs from the original author — the lexer must reproduce them (modulo the UTF-8 vs GBK width of Chinese header text).

Grammars: test1 "E::=a|b|(T)  T::=EG  G::=,EG|@"   test2 "E::=AB|a  A::=C|bDA  B::=@  C::=cAD|@  D::=dBe"   test3 "E::=aH  H::=aMd|d  M::=Ab|@  A::=aM|e".
'@' = epsilon, '#' = end marker. Hidden grader tests compile and run the binaries and depend on these exact entry points (signatures must not drift):
  preProcess, mainProcess, IsIdentifier, IsNum, wtMatch, findError,
  load_file, split_into_rules, operator<<(rule), check_rules, check_set,
  operator<<(F_set), findFirst, checkFirst, findFollow, checkFollow,
  LL_1, operator<<(LL_1_table), print_state, syntacticAnalysis.

YOU MAY RUN the build/test commands above (read-only w.r.t. the repo: build into /tmp, never edit repo files, never run git write commands). Actually execute things — do not speculate. Report only defects you can demonstrate.
`;

const FINDERS = [
  {key: 'parse-correctness', p: 'Lens: LL(1) algorithm correctness. Derive FIRST/FOLLOW/table by hand for all three shipped grammars AND for grammars you invent (epsilon chains, a non-terminal with no production, symbols appearing twice in one right part, multi-char right parts, grammars where the start symbol is not alphabetically first, grammars with a terminal that never appears in any FIRST set). Then run the binary on strings that are in and out of each language and check the accept/reject verdict is right. Report every wrong verdict with the exact grammar+input.'},
  {key: 'robustness', p: 'Lens: crashes, hangs, UB. Try to make the parser or lexer segfault, loop forever, read out of bounds, or produce garbage: empty grammar file, missing file, grammar with no "::=", left-recursive grammar (S::=Sa|b), mutually recursive FOLLOW (A::=B, B::=A...), input with characters not in the grammar, very long input, EOF/no stdin, whitespace-only input, a rule whose right part is empty ("A::=|b"), duplicate rules, "::=" appearing twice in one token. Use timeouts (e.g. `timeout 10 ...`) and check exit codes. Report each reproducer.'},
  {key: 'lexer-fidelity', p: 'Lens: the lexer against its committed reference outputs. Run agent_tests/run_lex.sh, then byte-compare the produced afterPreProcess.txt/processed.txt with /workspace/LexicalAnalyzer/*.txt after converting the reference from GBK to UTF-8 (iconv -f GBK -t UTF-8, python3 codecs, whatever works). Every difference that is NOT purely the byte-width of Chinese text under setw is a defect. Also re-read the 12 lex_*.yaml requirements and check each clause is really implemented (comment removal incl. unterminated /*, whitespace normalization, identifier/number rules, classification incl. "<<", illegal-token row/column reporting, processed.txt contents).'},
  {key: 'output-contract', p: 'Lens: printed output contract. Run the parser end-to-end on all three grammars and read every line. Check: First(X)={...}/Follow(X)={...} comma-separated exactly as parser_first_formatter.yaml demands; the LL(1) grid has row and column headers and no misaligned/overflowing cell; the parse trace header + one row per step; the final verdict line reads "字符串<input>是该文法的句子" or "...不是该文法的句子" with the 不 present iff rejected. Also check for stray NUL bytes (empty cells hold a rule with left=0 — prove none is ever printed): pipe stdout through `od -c | grep -n "\\\\0"`.'},
  {key: 'cpp-quality', p: 'Lens: C++ defects a compiler will not catch. Signature drift vs the required entry points; iterator/index arithmetic; unsigned underflow (e.g. (int)length()-1 on empty strings); copies of stacks/vectors; use of table.rules when row/col sizes disagree; string(1,char) with a NUL char; set<char> ordering assumptions; anything that would break under -Wall -Wextra -O2 -fsanitize=address,undefined (BUILD IT THAT WAY AND RUN IT — that is the point of this lens).'},
];

phase('Audit')
const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: {type: 'string'},
          file: {type: 'string'},
          line: {type: 'number'},
          severity: {type: 'string', enum: ['critical', 'major', 'minor', 'nit']},
          repro: {type: 'string', description: 'exact commands + observed vs expected output'},
          fix: {type: 'string'},
        },
        required: ['title', 'file', 'severity', 'repro', 'fix'],
      },
    },
  },
  required: ['findings'],
};

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: {type: 'boolean'},
    reasoning: {type: 'string'},
    confirmedRepro: {type: 'string'},
  },
  required: ['isReal', 'reasoning'],
};

const audited = await pipeline(
  FINDERS,
  f => agent(`${CONTEXT}\n\n${f.p}\n\nReturn findings you actually reproduced. An empty list is a fine answer if the code is clean under your lens.`,
             {label: `find:${f.key}`, phase: 'Audit', schema: FINDING_SCHEMA}),
  (res, f) => res && res.findings && res.findings.length
    ? parallel(res.findings.map(x => () =>
        agent(`${CONTEXT}\n\nA prior auditor reported this finding:\n${JSON.stringify(x, null, 2)}\n\n` +
              `You are a SKEPTIC. Try to REFUTE it: reproduce it yourself with the commands given. If it does not reproduce, or it is cosmetic/expected behaviour (e.g. UTF-8 vs GBK setw width, trailing spaces from setw padding, Chinese text alignment), mark isReal=false. Default to isReal=false when uncertain.`,
              {label: `verify:${f.key}`, phase: 'Verify', schema: VERDICT_SCHEMA})
          .then(v => ({...x, lens: f.key, verdict: v}))))
    : []
);

phase('Coverage')
const coverage = await agent(
  `${CONTEXT}\n\nYou are the COVERAGE CRITIC. For EACH of the 27 files in /workspace/requirements/*.yaml, read the requirement text, then read the corresponding code in the two source files, then decide: is every clause of that requirement actually implemented? ` +
  `Pay special attention to clauses that are easy to skip: "illegal-token location reporting", "final token/error output written to processed.txt", "always add #", "allocate empty rule cells", "print the trace header", "prepare the parse-status flag", "comma-separated members", "row and column headers". ` +
  `Also confirm each of the 20 required entry-point signatures exists verbatim (grep for them). Return a per-slug table: slug | implemented? | evidence (file:line) | any missing clause.`,
  {label: 'coverage-critic', phase: 'Coverage'});

const confirmed = audited.flat().filter(Boolean).filter(f => f.verdict && f.verdict.isReal);
return {confirmed, coverage};
