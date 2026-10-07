export const meta = {
  name: 'verify-compiler-lab-reconstruction',
  description: 'Independently verify reverse-engineered formats and compute ground-truth FIRST/FOLLOW/LL(1) data for the compiler lab',
  phases: [
    { title: 'Analyze', detail: 'independent analysis of reference artifacts and grammars' },
    { title: 'Critique', detail: 'adversarially check the derived conclusions' },
  ],
}

const LEX_CTX = `Working dir /workspace. Repo is a Chinese compiler-lab project (DenryDu). Files:
- LexicalAnalyzer/testCpp.txt  (GBK-encoded C++ source sample, the RAW input)
- LexicalAnalyzer/afterPreProcess.txt (reference output of preProcess)
- LexicalAnalyzer/processed.txt (GBK-encoded reference output of mainProcess; decode with: python3 -c "print(open('LexicalAnalyzer/processed.txt','rb').read().decode('gbk'))")
- LexicalAnalyzer/LexicalAnalysis.cpp (function bodies stripped, stubs marked TODO)
- LexicalAnalyzer/readme.md (contains the word->type table)
Use python3 for byte-exact inspection. Do NOT modify any file.`

const PARSER_CTX = `Working dir /workspace. Parser/SyntacticParser.cpp is an LL(1) parser with stripped bodies.
Grammars (@ means epsilon, # means end marker):
  test1.txt: E::=a|b|(T)    T::=EG    G::=,EG|@
  test2.txt: E::=AB|a       A::=C|bDA      B::=@     C::=cAD|@     D::=dBe
  test3.txt: E::=aH       H::=aMd|d       M::=Ab|@     A::=aM|e
Start symbol is the left part of the FIRST rule in the file.
Do NOT modify any file.`

phase('Analyze')

const tasks = [
  {
    label: 'preprocess-pipeline',
    prompt: `${LEX_CTX}

TASK: Determine the EXACT character transformation that maps testCpp.txt -> afterPreProcess.txt.
Write a throwaway python script in /tmp (never inside /workspace) that implements your hypothesis and byte-compares to afterPreProcess.txt. Iterate until byte-exact.
Report: (1) the exact ordered steps (comment removal semantics for // and multi-line /* */, what happens to \\n \\t \\r, how repeated spaces collapse, whether a trailing newline is written), (2) the verified python code, (3) byte length of the result and whether it matched exactly.`,
  },
  {
    label: 'token-table-format',
    prompt: `${LEX_CTX}

TASK: Reverse engineer the EXACT output format of processed.txt (GBK). Determine, in BYTES (GBK: each Chinese char is 2 bytes):
1. The column field widths used by C++ iomanip setw for the header line and for each data row. Prove it by computing byte offsets.
2. The exact literal text (in Chinese) of the header and of the illegal-token report section, including every space and whether lines have trailing spaces.
3. The tokenization implied by the row list: list every token index 1..38 with its spelling and type code, and identify which indexes are MISSING (illegal tokens).
4. Cross-check against LexicalAnalyzer/readme.md's word->type table.
5. From testCpp.txt, verify the row/column numbers reported for the illegal token "2res": are line numbers 1-based? are column numbers 0-based (i.e. raw std::string::find offsets) or 1-based? Show the arithmetic.
Report all findings precisely with byte offsets.`,
  },
  {
    label: 'grammar-ground-truth',
    prompt: `${PARSER_CTX}

TASK: For EACH of the three grammars, compute by hand (show work) and report as data:
1. The set of non-terminals, the set of terminals (excluding @), and the set of distinct right-hand-side alternatives (right_parts).
2. FIRST set of every distinct right-hand-side alternative string.
3. FOLLOW set of every non-terminal, using the STANDARD definition, and ALSO note what changes if the implementation unconditionally adds '#' to every FOLLOW set (the requirement text says findFollow should "always add #").
4. The full LL(1) parsing table (rows = non-terminals in grammar-rule order, columns = terminals sorted ascending by ASCII then '#').
5. Whether each grammar is LL(1) (any cell conflicts?).
Be rigorous; this is ground truth for tests.`,
  },
  {
    label: 'parse-traces',
    prompt: `${PARSER_CTX}

TASK: Produce accepted/rejected verdicts and full step-by-step LL(1) parse traces (analysis stack bottom-to-top, remaining input, production used) for:
- test1 grammar (start E): strings "(a,a)"  and "(a,a"  and "b"  and "a,b"
- test2 grammar (start E): strings "bdde" ... first determine 2 strings, one accepted one rejected, and show why
- test3 grammar (start E): strings "aaabd" (readme claims accepted) and "aad" and "ad" and "aab"
Initial analysis stack is "#S" (S=start), input stack is input + '#'.
Accept when both stacks reach '#'. Report a compact table per string plus the final verdict.`,
  },
  {
    label: 'stub-contract',
    prompt: `${LEX_CTX}
Also read /workspace/Parser/SyntacticParser.cpp and every file in /workspace/requirements/.

TASK: Extract the hard contract that any implementation must satisfy:
1. List every function signature that must exist verbatim in each .cpp file.
2. For LexicalAnalysis.cpp main(): what file paths are used, and note that mainProcess() receives the PREPROCESSED filename, yet the illegal-token report in processed.txt cites line/column positions in the ORIGINAL testCpp.txt. Explain what that implies findError must be called with.
3. For SyntacticParser.cpp syntacticAnalysis(): the stub already ends with cout << endl << "字符串" << input; cout << "不"; cout << "是该文法的句子";  — explain the implied control flow (a bool flag) and that syntacticAnalysis only receives the LL_1_table, so the START SYMBOL must be recoverable from table.row[0]. Given test3's non-terminals {A,E,H,M} and start symbol E, what does that prove about the ORDER of table.row?
4. Note the source .cpp files are UTF-8 but the reference processed.txt is GBK. Discuss which encoding new string literals should use and the consequence for setw alignment.
Report a crisp checklist.`,
  },
]

const analyses = await parallel(tasks.map(t => () =>
  agent(t.prompt, { label: t.label, phase: 'Analyze' })))

phase('Critique')

const critiques = await parallel(analyses.filter(Boolean).map((a, i) => () =>
  agent(`You are an adversarial reviewer. Working dir /workspace (read-only for you).

Another analyst produced the following report for task "${tasks[i].label}":

<report>
${a}
</report>

TASK: Try hard to REFUTE it. Independently re-derive the key claims (use python3 / your own hand computation / read the actual files). List every claim that is WRONG, unverified, or ambiguous, and give the corrected value. If everything checks out, say so explicitly and state what you re-verified and how.`,
    { label: `critique:${tasks[i].label}`, phase: 'Critique' })))

return {
  analyses: analyses.map((a, i) => ({ task: tasks[i].label, report: a })),
  critiques: critiques.map((c, i) => ({ task: tasks[i].label, critique: c })),
}
