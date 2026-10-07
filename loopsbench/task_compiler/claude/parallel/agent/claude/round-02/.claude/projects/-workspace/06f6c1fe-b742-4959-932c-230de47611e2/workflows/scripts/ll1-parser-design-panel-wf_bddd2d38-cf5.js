export const meta = {
  name: 'll1-parser-design-panel',
  description: 'Independent design proposals + adversarial judging for the remaining LL(1) parser functions in /workspace/Parser/SyntacticParser.cpp',
  phases: [
    { title: 'Design', detail: '4 independent full designs for the 12 remaining functions' },
    { title: 'Judge', detail: 'score each design on correctness, requirement fidelity, style fit' },
    { title: 'Synthesize', detail: 'merge into one recommended design' },
  ],
}

const CONTEXT = `
You are advising on a C++ compiler-lab project at /workspace (READ ONLY — do NOT edit any file, do not run git commands that mutate state).

Read these files first:
- /workspace/Parser/SyntacticParser.cpp  (the file being completed; struct definitions, main(), and the already-implemented load_file / operator<<(rule) / split_into_rules / check_rules / check_set)
- /workspace/Parser/readme.md            (Chinese lab spec: what the program must display)
- /workspace/Parser/test1.txt, test2.txt, test3.txt (the three grammars)
- /workspace/LexicalAnalyzer/LexicalAnalysis.cpp (sibling program, already finished — copy its coding style: tabs, C++98-ish loops, Chinese comments, setw-formatted tables)
- /workspace/requirements/parser_*.yaml  (the requirement statements)
- /workspace/agent_tests/run_parser.sh   (how the binary is built and driven: g++ -std=c++11 -Wall, grammar copied to test3.txt, input string piped on stdin)

STILL UNIMPLEMENTED (all in Parser/SyntacticParser.cpp), each is one requirement:
  parser_grammar_io      check_rules + check_set (already written; only needs a small robustness improvement)
  parser_first_formatter ostream& operator<<(ostream&, F_set)
  parser_first_core      F_set findFirst(const string ss, vector<rule> rules)
  parser_first_sets      vector<F_set> checkFirst(set<string> right_parts, vector<rule> rules)
  parser_follow_core     F_set findFollow(const char non_terminal, vector<rule> rules)
  parser_follow_sets     vector<F_set> checkFollow(set<char> non_terminal, vector<rule> rules)
  parser_ll1_header      first half of LL_1(): header row/col + empty cells
  parser_ll1_builder     second half of LL_1(): fill cells from FIRST/FOLLOW
  parser_ll1_table       ostream& operator<<(ostream&, LL_1_table)
  parser_parse_state     void print_state(stack<char>, stack<char>, rule&)
  parser_analysis_init   bootstrap half of syntacticAnalysis()
  parser_analysis        parse-loop half of syntacticAnalysis()

Hard constraints: the listed signatures cannot change; struct definitions (rule, F_set, LL_1_table) cannot change; main() should not need changes; '@' means epsilon; '#' is the end marker; the program must compile clean with g++ -std=c++11 -Wall.

Key open questions you MUST answer concretely:
 1. LL_1_table.row vs .col: which holds non-terminals and which holds terminals+'#'? How are cells indexed in the flat vector<rule> rules? Justify from the struct comments in readme.md ("行表头数组" / "列表头数组") and from what syntacticAnalysis needs.
 2. syntacticAnalysis only receives the table — how does it learn the grammar START symbol? (Consider: if row is built from the sorted set<char> non_terminal, row[0] is 'A' for test3 whose start symbol is 'E'.) What is the safest construction?
 3. findFollow: requirement text says "always add '#'". Does unconditionally seeding '#' into EVERY follow set break acceptance/rejection for the three shipped grammars? Trace it.
 4. Recursion termination for findFirst/findFollow on the shipped grammars and in general (left recursion, mutual recursion). Signatures are fixed — how do you add a guard?
 5. Exact printed formats for: F_set ("First(X)={a,b}" / "Follow(X)={#,a}"), the LL(1) table grid, the parse trace header + rows, and the final verdict line (the existing tail is: cout << endl << "字符串" << input;  cout << "不";  cout << "是该文法的句子"; — the "不" must become conditional).
 6. How print_state should render a terminal-MATCH step (no production involved) given it only receives a rule&.

Deliverable: a complete, compilable design. Include the actual C++ code you propose for every one of the 12 items, in the project's style, with Chinese comments matching the surrounding code. Also hand-trace: grammar test3 (E::=aH  H::=aMd|d  M::=Ab|@  A::=aM|e) with input "aaabd" (must be ACCEPTED) and input "aab" (must be REJECTED), and grammar test1 (E::=a|b|(T)  T::=EG  G::=,EG|@) with input "(a,a)" (ACCEPTED).
`;

phase('Design')
const ANGLES = [
  {key: 'faithful', p: 'Angle: maximum fidelity to what the original Chinese lab author most plausibly wrote. Prefer the simplest textbook LL(1) code that a student would write, and match the sibling lexer\'s output style exactly (setw tables, printTips-free but same table feel).'},
  {key: 'robust',   p: 'Angle: robustness and defensive correctness. Assume hidden tests may feed other grammars/strings than the three shipped ones: guard against missing table cells, unknown input symbols, empty grammars, infinite recursion, out-of-range indices, and stdin EOF.'},
  {key: 'formats',  p: 'Angle: printed output is the contract. Obsess over the exact strings and column layout of every cout in the remaining functions, including how UTF-8 Chinese interacts with setw (the sibling lexer already accepts that misalignment). Enumerate every line the finished program will print for grammar test3 + input aaabd, end to end.'},
  {key: 'spec',     p: 'Angle: requirement-by-requirement fidelity. For each of the 12 parser_*.yaml requirement texts, quote the wording and show precisely which lines of your proposed code satisfy each clause, so that no clause ("always add #", "allocate empty rule cells", "prepare the parse-status flag", "print the trace header", ...) is left unimplemented.'},
]

const designs = await parallel(ANGLES.map(a => () =>
  agent(`${CONTEXT}\n\n${a.p}\n\nReturn your full design as markdown with fenced C++ code blocks.`,
        {label: `design:${a.key}`, phase: 'Design'})))

phase('Judge')
const valid = designs.map((d, i) => ({key: ANGLES[i].key, text: d})).filter(d => d.text)
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: {type: 'string'},
          correctness: {type: 'number'},
          fidelity: {type: 'number'},
          style: {type: 'number'},
          notes: {type: 'string'},
        },
        required: ['key', 'correctness', 'fidelity', 'style', 'notes'],
      },
    },
    bestKey: {type: 'string'},
    criticalFlaws: {type: 'array', items: {type: 'string'}},
  },
  required: ['scores', 'bestKey', 'criticalFlaws'],
}
const LENSES = ['parse-correctness (hand-execute the traces yourself, do not trust their claims)',
                'requirement-clause coverage against /workspace/requirements/parser_*.yaml',
                'compile-ability under g++ -std=c++11 -Wall (type errors, const issues, unused vars, signature drift)']
const judgments = await parallel(LENSES.map((lens, i) => () =>
  agent(`${CONTEXT}\n\nYou are JUDGE ${i + 1}. Lens: ${lens}.\n\nHere are ${valid.length} competing designs:\n\n` +
        valid.map(d => `===== DESIGN ${d.key} =====\n${d.text}`).join('\n\n') +
        `\n\nScore each 0-10 on correctness, fidelity, style through your lens. List every CRITICAL flaw you can prove (with the concrete input that breaks it).`,
        {label: `judge:${i + 1}`, phase: 'Judge', schema: JUDGE_SCHEMA})))

phase('Synthesize')
const synthesis = await agent(
  `${CONTEXT}\n\nBelow are ${valid.length} independent designs and ${judgments.filter(Boolean).length} judge reports.\n\n` +
  valid.map(d => `===== DESIGN ${d.key} =====\n${d.text}`).join('\n\n') +
  `\n\n===== JUDGE REPORTS =====\n${JSON.stringify(judgments.filter(Boolean), null, 2)}\n\n` +
  `Produce THE final recommended implementation: one fenced C++ block per remaining item, ready to paste into Parser/SyntacticParser.cpp, resolving every critical flaw the judges proved. ` +
  `Then give: (a) a table mapping each of the 12 requirement slugs to the exact code that satisfies it and which commit it should land in, (b) the precise expected stdout for grammar test3 with input "aaabd", (c) any residual risk. Be exhaustive and concrete.`,
  {label: 'synthesize', phase: 'Synthesize'})

return synthesis
