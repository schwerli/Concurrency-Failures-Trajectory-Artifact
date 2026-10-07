export const meta = {
  name: 'restore-stubbed-ds-implementations',
  description: 'Restore 145 stubbed Java methods across 17 data-structures modules from recovered reference bytecode, then adversarially verify each',
  phases: [
    { title: 'Implement', detail: 'one agent per module: transcribe recovered bodies into the stubs, compile, run' },
    { title: 'Verify', detail: 'independent agent re-checks each module against the reference and re-runs it' },
  ],
}

const COMMON = `
You are restoring stubbed-out method bodies in a Java data-structures course project at /workspace.

## The situation
Each target .java file has some methods replaced by:
    throw new UnsupportedOperationException("TODO: implement");
Your job: restore a correct body for every one of those methods.

## You have reference implementations — USE THEM
The repo shipped the ORIGINAL compiled .class files (built from the pre-stub
sources). They were decompiled with CFR into /tmp/ref/<ModuleName>/<Class>.java.
The decompiled code is SEMANTICALLY EXACT: same algorithm, same output strings,
same control flow. The method list and ORDER in the reference matches the stub
file 1:1. But it is decompiler output, so:
  - Local variable names are generic (string, string2, n, n2, arrayList, d).
    Rename them to something meaningful that matches the stub file's own naming
    style and the parameter names in its javadoc/comments.
  - CFR emits synthetic labelled blocks ("block8: { block9: { ... } }") and
    "continue block0;" for what was originally plain if/else-if/else or nested
    loops. Rewrite these into natural, idiomatic Java with the SAME semantics.
    Do not leave CFR labels in the final source.
  - Calls appear fully qualified (Main.foo(x)); write them as the surrounding
    code does (foo(x)).
  - Boxing is explicit (logOn.booleanValue(), (Double)x). Write it naturally.
  - Chinese string literals have already been unescaped to real characters.

If /tmp/ref is missing, regenerate it with: bash /workspace/agent_tests/regen_reference.sh

## Hard rules
1. Change ONLY the bodies of methods that currently throw
   UnsupportedOperationException. Do not touch any other method, field,
   class, import, or comment. Do not reorder or reformat untouched code.
2. Keep every method signature, name, visibility and static-ness EXACTLY as-is.
3. Preserve output strings byte-for-byte (including Chinese text, spaces,
   punctuation, \\n, and printf format specifiers). Tests compare stdout.
4. Match the surrounding brace/indent style (4 spaces; the project writes
   "if(cond) {" and "i ++" in places — follow the file's local convention).
5. NEVER compile into the module directory. The .class files there are the
   reference and must not be clobbered. Always use:
       cd /workspace/<module> && LANG=C.UTF-8 javac -encoding UTF-8 -d /tmp/build/<name> ./*.java
6. NEVER modify tracked data files (samples.txt, data.txt, order.txt,
   random.txt, task.dat, example*.txt, example4.key, example4.encrapy,
   headnode, log.txt). If the program WRITES files, do your run-testing inside
   a scratch copy:  cp -r /workspace/<module> /tmp/run/<name> && cd /tmp/run/<name>
7. Do not create, stage, or commit anything in git. Do not run git commands
   that change state. The parent agent handles commits.
8. Do not add new files to the module directory.

## Verifying
- Compile must be clean (no errors).
- The programs are interactive menu loops. Read the NON-stubbed main()/menu()
  to learn the exact input protocol, then drive it:
      printf '1\\n2\\n...\\n' | timeout 20 java -cp /tmp/build/<name> <MainClass>
  Run from a directory where the needed data files are present (the scratch
  copy, or the module dir if the program only reads).
  A trailing NoSuchElementException / "No line found" at EOF is EXPECTED for
  infinite menu loops - that is not a failure. What matters is that the
  algorithm output before it is correct and no UnsupportedOperationException,
  NullPointerException, or wrong-looking output appears.
- Sanity-check the actual algorithm output by hand (is the postfix expression
  right? is the traversal order right? is the MST weight minimal?).

## Report back
Return a concise report: the file(s) touched, how many stub bodies you
restored, the exact compile command result, what you ran and the key output
you observed, and anything you could NOT verify. Be honest about gaps.
`

const MODULES = [
  {
    slug: 'dsexp01_stack', label: 'DSExp01_Stack', dir: 'Experiments/DSExp01_Stack',
    files: 'DSExperiment.java', ref: '/tmp/ref/DSExp01_Stack', stubs: 4, main: 'DSExperiment',
    notes: `SPECIAL: this module has the PRISTINE original source, not just decompiled output.
/tmp/ref/DSExp01_Stack/DSExperiment.ORIGINAL.java was extracted from the submission
.zip in the module directory and is the exact pre-stub text, with the original
variable names and formatting. Copy the four stubbed method bodies
(addMultiply, convertToPostfix, splitIntoPieces, calculatePostfixExpression)
VERBATIM from that file. Prefer it over the decompiled DSExperiment.java.
Do not overwrite the whole stub file blindly - only transplant those 4 bodies,
and confirm the rest of the stub file already matches.
Run protocol: first prompt is "log mode (y or n)", then mode 1 = read samples.txt.
So: printf 'n\\n1\\n' | timeout 20 java -cp /tmp/build/DSExp01_Stack DSExperiment
Note it writes log.txt when log mode is on - use a scratch copy if you enable it.
Acceptance signals the graders call directly:
  convertToPostfix(String)->String  (space-separated postfix)
  calculatePostfixExpression(String)->double
  addMultiply(String)->String  (inserts implicit '*' between digit and letter)
  splitIntoPieces(String)->ArrayList<String>`,
  },
  {
    slug: 'dsexp02_tree', label: 'DSExp02_Tree', dir: 'Experiments/DSExp02_Tree',
    files: 'DSLab2.java', ref: '/tmp/ref/DSExp02_Tree', stubs: 13, main: 'DSLab2',
    notes: `13 stubs: menu, inputTree, createTree, outputTree, levelTraverse,
recursivePreOrder, recursiveInOrder, recursivePostOrder, iteratedPreOrder,
iteratedInOrder, iteratedPostOrder, judgeTree, findAncestor, findNearsetAncestor.
Reference: /tmp/ref/DSExp02_Tree/DSLab2.java (312 lines, all 13 present).
The helper classes TreeNode/Stack/Queue live in the same stub file and are NOT
stubbed - read them to see the available API (note getFlag/setFlag, used by the
iterative post-order and by judgeTree).
The tree is built from pre-order user input; read inputTree/createTree in the
reference to learn the sentinel for an empty child, then drive the menu
accordingly. There is no data file - all input is stdin.`,
  },
  {
    slug: 'dsexp03_graph', label: 'DSExp03_Graph', dir: 'Experiments/DSExp03_Graph',
    files: 'Main.java', ref: '/tmp/ref/DSExp03_Graph', stubs: 16, main: 'Main',
    notes: `16 stubs covering both representations: menu, buildStructure, buildMatrix,
buildTable, convertStructure, convertToTable, convertToMatrix, depthFirst,
recursiveMatrixDFS, DFS2, iterativeMatrixDFS, recursiveTableDFS, DFS1,
iterativeTableDFS, breadthFirst, matrixBFS, tableBFS, showMatrix, showTable
(whichever of these currently throw).
Reference: /tmp/ref/DSExp03_Graph/Main.java (491 lines).
Reads data.txt (edge list) from the module directory - read it first so you know
the vertex count and edge format, and so you can hand-check the traversals.
Graders call DFS2(int i) directly: recursive DFS step on the adjacency MATRIX -
it prints the vertex, marks it visited, and records the DFN. Get the print
format and the visited/DFN bookkeeping exactly right.
DFS1(int i) is the adjacency-LIST counterpart.`,
  },
  {
    slug: 'dsexp04_search', label: 'DSExp04_Search', dir: 'Experiments/DSExp04_Search',
    files: 'Main.java', ref: '/tmp/ref/DSExp04_Search', stubs: 21, main: 'Main',
    notes: `Largest module: 21 stubs. Reference: /tmp/ref/DSExp04_Search/Main.java (573 lines).
Covers BST build/insert/delete/deletemin/search/sort plus the half-search
(decision tree) structure and the average-search-length analysis
(BSTAverage, searchRandomFailure/Success, searchOrderFailure/Success,
halfAverage, halfFailure, halfSuccess, buildHalfTree, buildHalfSearchArray,
binarySearch).
Reads order.txt and random.txt from the module directory.
Graders call directly:
  insertBST(NodeType node, NodeType parent, int value) -> void   (recursive insert)
  searchBST(NodeType node, int value) -> int                     (returns value, or -1)
  sortBST(NodeType node) -> void                                 (in-order, appends to the allElements list)
Note insertBST takes a parent pointer because NodeType stores getParentNode/
setParentNode - keep the parent links correct, deleteBST/deletemin depend on them.`,
  },
  {
    slug: 'dsexp05_hash', label: 'DSExp05_Hash', dir: 'Experiments/DSExp05_Hash',
    files: 'Main.java', ref: '/tmp/ref/DSExp05_Hash', stubs: 7, main: 'Main',
    notes: `7 stubs. Reference: /tmp/ref/DSExp05_Hash/Main.java (148 lines).
Consistent hashing with virtual nodes: server IP generation, the FNV-like hash
function, ring placement (a sorted/tree map keyed by hash), add server, remove
server, and lookup-which-server-handles-a-key.
The hash function must be transcribed EXACTLY - every constant, every shift,
every mask, and the exact integer type/overflow behaviour. Any deviation
changes the whole mapping. Double-check the reference bytecode-derived
arithmetic (Integer.MAX_VALUE masking, & 0xFFFFFFFFL, etc).
No data file; the server list is generated in code.`,
  },
  {
    slug: 'dsexp05_redblacktree', label: 'DSExp05_RedBlackTree', dir: 'Experiments/DSExp05_RedBlackTree',
    files: 'Main.java', ref: '/tmp/ref/DSExp05_RedBlackTree', stubs: 13, main: 'Main',
    notes: `13 stubs. Reference: /tmp/ref/DSExp05_RedBlackTree/Main.java (451 lines).
Full red-black tree: left/right rotation, post-INSERT rebalance, post-DELETE
rebalance, search, in-order traversal, average search length. Reads order.txt.
Graders call directly:
  insertBST(TreeNode node, int record) -> TreeNode   (plain BST placement, RETURNS the new node)
  balanceTree(TreeNode targetNode) -> void           (post-insertion recolour/rotate)
TreeNode is in the same directory (TreeNode.class only - see /tmp/ref/.../TreeNode.java
for its API: colour field, parent/left/right). Get the uncle-red / uncle-black
zig-zag cases and the root-recolour exactly right, and make sure the static root
field is updated when a rotation moves the root.`,
  },
  {
    slug: 'ds01', label: 'DS01_a', dir: 'Homework/DS01',
    files: 'DS01_1.java DS01_2.java DS01_3.java', ref: '/tmp/ref/DS01', stubs: 4,
    notes: `THREE separate single-file programs, 4 stubs total. Each has its own main.
They must be compiled INDIVIDUALLY (DS01_3.java declares helper classes Node/Stack
that would collide) e.g.
  cd /workspace/Homework/DS01 && LANG=C.UTF-8 javac -encoding UTF-8 -d /tmp/build/DS01_1 DS01_1.java

DS01_3.java (1 stub): reference AVAILABLE at /tmp/ref/DS01/DS01_3.java plus
  /tmp/ref/DS01/'DS01_3$Node.java' and 'DS01_3$Stack.java'. DFS-based
  Hamiltonian-path search on a graph. Transcribe it.

DS01_1.java (2 stubs): NO reference class exists - implement from scratch.
  quickSort(String[] samples, int start, int end) and
  myCompare(String a, String b). Standard recursive quicksort (pick a pivot,
  partition, recurse) that orders the array using myCompare as the ordering
  predicate. The data is {"PAB","5C","PABC","CXY","CRSI","7","B899","B9"} -
  a mix of letters and digits of differing lengths. myCompare must compare the
  two strings character by character and, when one is a prefix of the other,
  order the SHORTER one first; return a negative/zero/positive int like
  Comparator.compare. Make quickSort stable-enough and total: the final printed
  order must be a correct ascending sort under myCompare, and running main must
  print all 8 tokens exactly once. Verify by actually running it.

DS01_2.java (1 stub): NO reference class - implement from scratch.
  findMax(int[] samples) must scan from BOTH ends toward the middle (two
  pointers, i from the left and j from the right, meeting in the middle) and
  fill the static fields maxNumber (the maximum value) and maxIndex (an
  ArrayList<Integer> of EVERY index holding that maximum, since random values
  can tie). main prints "The max number is <n> and the max index is [..]".
  maxIndex must end up sorted ascending and contain no duplicates - be careful
  at the meeting point so the middle element is not counted twice and neither
  pointer is skipped. Verify by running it several times and cross-checking the
  printed array against the printed maximum.`,
  },
  {
    slug: 'ds01_4', label: 'DS01_4', dir: 'Homework/DS01',
    files: 'DS01_4.java', ref: '(none)', stubs: 9,
    notes: `NO reference class exists for DS01_4.java - implement all 9 stubs from scratch.
This is a sports-competition scoring/query system. Compile it on its own:
  cd /workspace/Homework/DS01 && LANG=C.UTF-8 javac -encoding UTF-8 -d /tmp/build/DS01_4 DS01_4.java
IMPORTANT: you are the ONLY agent allowed to edit DS01_4.java. Another agent is
concurrently editing DS01_1/2/3.java in the same directory - do not touch those
files, and if you see them change mid-run that is expected.

Read the whole file first. The non-stubbed parts tell you almost everything:
  - static fields schoolNumber, projectNumber, manProjectNumber,
    womanProjectNumber, schoolList (ArrayList<School>), projectList
    (ArrayList<Project>), scanner.
  - class School(int schoolLabel) with getSchoolLabel, getTotalScore/
    addTotalScore, getMaleScore/addMaleScore, getFemaleScore/addFemaleScore.
  - class Project(int projectLabel, boolean isMaleProject, boolean isThreeProject)
    with addWinnerSchools/clearWinnerSchools/getWinnerSchools and getters.
    "isThreeProject" = only the top THREE place, otherwise the top FIVE do.
  - four ready-made comparators: ComparatorById (ascending school label),
    ComparatorByTotal, ComparatorByMale, ComparatorByFemale (all descending).
  - searchInNumber() is already written and calls searchBySchool()/searchByProject().
  - main(): asks "是否从文件读取(y or n)？"; on "y" calls readFromFile(), else
    initialList(); then loops forever on menu().

Implement, keeping every existing Chinese prompt style and using the fields and
comparators above:
  initialList()      - prompt for the number of schools and the number of events,
                       how many are men's vs women's, and which events award
                       3 vs 5 places; populate schoolList with School objects
                       labelled 1..schoolNumber and projectList with Project
                       objects labelled 1..projectNumber. Keep manProjectNumber
                       and womanProjectNumber consistent with what was entered.
  menu()             - print a numbered menu and dispatch to inputScore,
                       schoolScoreInfo, outputScore, searchInNumber,
                       writeToFile, and an exit option (System.exit(0)).
                       Print "输入选择有误！" style message on a bad choice.
  inputScore()       - for a chosen event, read the winning school labels in
                       finishing order (3 or 5 of them per getIsThreeProject),
                       award points (top-three events: 5/3/2; top-five events:
                       7/5/3/2/1), and add them to that school's total plus its
                       male or female subtotal per getIsMaleProject(). Register
                       the winners on the Project via addWinnerSchools (clear
                       first so re-entering an event does not double-count).
  schoolScoreInfo()  - print every school's label, total, male and female score.
  outputScore()      - offer sorting by school label / total / male / female,
                       use Collections.sort with the matching comparator, and
                       print the ranked table.
  searchBySchool()   - read a school label, print that school's scores and the
                       events it placed in, with its position and points.
  searchByProject()  - read an event label, print that event's ranked winners
                       and their points.
  writeToFile()      - ObjectOutputStream over a FileOutputStream; serialise
                       schoolList and projectList (and the four counts) so
                       readFromFile can restore them.
  readFromFile()     - the exact inverse with ObjectInputStream; it is already
                       annotated @SuppressWarnings("unchecked") so casting the
                       deserialised ArrayLists is expected. Handle a missing
                       file gracefully (catch, message, fall back to
                       initialList() or an empty state) rather than crashing.

Both file methods must round-trip: write, then read back, and the scores must
match. VERIFY THIS by actually running the program twice with scripted stdin
inside a scratch copy (/tmp/run/DS01_4) so no file lands in the repo. Confirm
no file was created under /workspace/Homework/DS01 when you are done.`,
  },
  {
    slug: 'ds02_linkedlist', label: 'DS02_LinkedList', dir: 'Homework/DS02_LinkedList',
    files: 'DS02.java', ref: '/tmp/ref/DS02_LinkedList', stubs: 11, main: 'DS02',
    notes: `11 stubs. Reference: /tmp/ref/DS02_LinkedList/DS02.java (324 lines) and
ProductNode.java (the node API).
Sorted linked list of products: add (keeping sort order), delete, search by
name, search by brand, update, and file persistence.
NOTE the module contains a file literally named "headnode" - that is the
serialised list the program reads/writes. It is tracked; do NOT overwrite it.
Do your run-testing in /tmp/run/DS02_LinkedList (cp -r the module first) and
confirm "headnode" in the repo is unchanged (git status must stay clean for it).`,
  },
  {
    slug: 'ds02_matrix', label: 'DS02_Matrix', dir: 'Homework/DS02_Matrix',
    files: 'CommonTransposition.java QuickTransposition.java', ref: '/tmp/ref/DS02_Matrix', stubs: 5,
    notes: `5 stubs across TWO files, 3 in CommonTransposition.java and 2 in
QuickTransposition.java. References: /tmp/ref/DS02_Matrix/CommonTransposition.java,
QuickTransposition.java, plus Triple.java and TripleComparator.java for the
helper API.
BOTH files declare their own copy of class Triple, so they MUST be compiled
separately:
  cd /workspace/Homework/DS02_Matrix
  LANG=C.UTF-8 javac -encoding UTF-8 -d /tmp/build/CT CommonTransposition.java
  LANG=C.UTF-8 javac -encoding UTF-8 -d /tmp/build/QT QuickTransposition.java
CommonTransposition = naive O(cols*n): for each column, sweep all triples.
QuickTransposition = O(n): count the entries per column, prefix-sum those into
per-column start positions, then place each triple in one pass.
Both must produce the SAME transposed triple list for the same input - verify
that by running both and diffing their output.`,
  },
  {
    slug: 'ds02_string', label: 'DS02_String', dir: 'Homework/DS02_String',
    files: 'DS_String.java', ref: '/tmp/ref/DS02_String', stubs: 2, main: 'DS_String',
    notes: `2 stubs. Reference: /tmp/ref/DS02_String/DS_String.java (70 lines) and Node.java.
Builds a character-level linked list from input, then does substring pattern
matching against it. Small and self-contained. All input is stdin - read the
non-stubbed main to learn the prompt order, then drive it and check that a known
pattern is found at the right position and a known absent pattern reports
not-found.`,
  },
  {
    slug: 'ds03_huffman', label: 'DS03_Huffman', dir: 'Homework/DS03_Huffman',
    files: 'HuffmanHomework.java', ref: '/tmp/ref/DS03_Huffman', stubs: 11, main: 'HuffmanHomework',
    notes: `11 stubs. Reference: /tmp/ref/DS03_Huffman/HuffmanHomework.java (343 lines),
plus TreeNode.java and TreeNodeComparator.java for the helper API.
Frequency count -> Huffman tree via greedy priority-queue selection -> encode to
a binary file plus a .key file -> decode back.
The module ships example1..4.txt, example4.encrapy and example4.key, all TRACKED.
The program WRITES files, so you MUST test in a scratch copy:
  cp -r /workspace/Homework/DS03_Huffman /tmp/run/Huffman && cd /tmp/run/Huffman
Round-trip test: encode example1.txt, then decode the result, then diff the
decoded text against example1.txt - they must be identical. Also confirm the
encoded file is smaller than the input. Then verify nothing in
/workspace/Homework/DS03_Huffman changed (git status).
There is also a design write-up in the module: 基于哈夫曼树的文本压缩.md -
consult it if the bit-packing / key-file format is ambiguous.`,
  },
  {
    slug: 'ds03_losertree', label: 'DS03_LoserTree', dir: 'Homework/DS03_LoserTree',
    files: 'Main.java', ref: '/tmp/ref/DS03_LoserTree', stubs: 4, main: 'Main',
    notes: `4 stubs. Reference: /tmp/ref/DS03_LoserTree/Main.java (135 lines) and TreeNode.java.
K-way merge with a loser tree: initialise K sorted runs, build the loser tree,
then repeatedly pull the overall minimum. Get the sentinel handling (the
MIN/MAX guard values used to prime the tournament and to retire an exhausted
run) exactly right - that is the usual source of bugs.
Verify the final output is fully sorted ascending and its length equals the
total number of input elements.`,
  },
  {
    slug: 'ds03_priorityqueue', label: 'DS03_PriorityQueue', dir: 'Homework/DS03_PriorityQueue',
    files: 'Main.java', ref: '/tmp/ref/DS03_PriorityQueue', stubs: 3, main: 'Main',
    notes: `3 stubs. Reference: /tmp/ref/DS03_PriorityQueue/Main.java (75 lines), plus
Heap.java and Node.java for the helper API.
MAX-heap: insertion with upward percolation, extract-max with downward
percolation. Reads tasks from task.dat in the module directory (tracked,
read-only for you).
Verify that repeatedly extracting the max yields the tasks in DESCENDING
priority order and that every task from task.dat comes out exactly once.`,
  },
  {
    slug: 'ds04_farmer', label: 'DS04_Farmer', dir: 'Homework/DS04_Farmer',
    files: 'Main.java', ref: '/tmp/ref/DS04_Farmer', stubs: 6, main: 'Main',
    notes: `6 stubs. Reference: /tmp/ref/DS04_Farmer/Main.java (134 lines), plus Node.java
and Stack.java for the helper API.
Farmer / wolf / goat / cabbage river crossing as an explicit state-space graph:
each node is a 4-tuple of bank positions. Implement state validity (the wolf
must not be left alone with the goat, nor the goat with the cabbage, unless the
farmer is present), edge construction between legal single-trip transitions
(the farmer always moves, carrying at most one item, and only an item on the
farmer's own bank), and DFS enumeration of ALL solutions.
Sanity check: the classic puzzle has exactly TWO minimal 7-crossing solutions.
Confirm the program reports solutions and that each printed solution really
starts at all-on-the-near-bank and ends at all-on-the-far-bank with no illegal
intermediate state.`,
  },
  {
    slug: 'ds04_islandlake', label: 'DS04_IslandLake', dir: 'Homework/DS04_IslandLake',
    files: 'Main.java', ref: '/tmp/ref/DS04_IslandLake', stubs: 2, main: 'Main',
    notes: `2 stubs. Reference: /tmp/ref/DS04_IslandLake/Main.java (115 lines), plus
Edge.java, Point.java and 'Main$1.java' (the anonymous edge Comparator).
Kruskal MST with union-find over a set of islands and their pairwise distances.
Verify: the chosen bridge set has exactly (islands - 1) edges, connects
everything, contains no cycle, and its total length is minimal (cross-check by
brute force over all spanning trees if the island count is small, or at least
confirm it equals the greedy answer you compute independently).`,
  },
  {
    slug: 'ds04_maze', label: 'DS04_Maze', dir: 'Homework/DS04_Maze',
    files: 'Main.java', ref: '/tmp/ref/DS04_Maze', stubs: 9, main: 'Main',
    notes: `9 stubs. Reference: /tmp/ref/DS04_Maze/Main.java (89 lines), plus MazeTools.java,
PrimGenerate.java, GetWay.java, MazeLabel.java and Stack.java for the API of the
helper classes (some helpers live in Main.java itself - check which classes the
stub file declares before assuming).
Maze generation (DFS wall carving + Prim's algorithm) and DFS solving, rendered
with Swing.
HEADLESS ENVIRONMENT: there is no display, so anything that constructs a JFrame
will throw HeadlessException. Do NOT treat that as a bug in your code.
Verification strategy instead:
  1. Compile cleanly - that is the primary gate.
  2. Exercise the pure-logic parts WITHOUT Swing by writing a tiny throwaway
     driver in /tmp (NOT in the repo) that calls the generation and solving
     methods directly (or via reflection if they are private) and prints the
     grid as ASCII. Confirm the generated maze is fully connected with no
     isolated cells, and that the DFS solution is a contiguous path from entry
     to exit that never crosses a wall.
  3. If a method is unreachable without a display, say so explicitly in your
     report rather than claiming it was verified.
Try java -Djava.awt.headless=true where it helps.`,
  },
  {
    slug: 'ds04_project', label: 'DS04_Project', dir: 'Homework/DS04_Project',
    files: 'Main.java', ref: '/tmp/ref/DS04_Project', stubs: 5, main: 'Main',
    notes: `5 stubs. Reference: /tmp/ref/DS04_Project/Main.java (152 lines), plus AOE.java,
EdgeNode.java, VertexNode.java and Stack.java for the helper API.
Activity-on-Edge network: build the AOE graph from data.txt (tracked, read-only),
display the adjacency list, compute earliest event times (forward pass in
topological order) and latest event times (backward pass), then enumerate the
critical path(s) by DFS over the zero-slack activities.
Verify against data.txt by hand: the critical path length must equal the
earliest time of the sink event, and every activity on the reported path must
have zero slack (latest start == earliest start).`,
  },
]

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    stubsRestored: { type: 'integer' },
    stubsRemaining: { type: 'integer' },
    compiles: { type: 'boolean' },
    ranSuccessfully: { type: 'boolean' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'commands run and key output observed' },
    unverified: { type: 'string', description: 'anything not verified, or "none"' },
  },
  required: ['slug', 'stubsRestored', 'stubsRemaining', 'compiles', 'ranSuccessfully', 'filesTouched', 'evidence', 'unverified'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    ok: { type: 'boolean', description: 'true only if every stub is genuinely restored, it compiles, and behaviour matches the reference' },
    stubsRemaining: { type: 'integer' },
    problems: { type: 'array', items: { type: 'string' } },
    fixesApplied: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
  required: ['slug', 'ok', 'stubsRemaining', 'problems', 'fixesApplied', 'evidence'],
}

log(`Restoring ${MODULES.reduce((a, m) => a + m.stubs, 0)}+ stub bodies across ${MODULES.length} work items`)

const results = await pipeline(
  MODULES,
  (m) => agent(
    `${COMMON}
## Your module: ${m.label}
Directory:  /workspace/${m.dir}
File(s):    ${m.files}
Reference:  ${m.ref}
Approximate number of stubs you must restore: ${m.stubs}

${m.notes}

Start by reading the stub file(s) in full and the reference in full, then edit.
When you are done, prove it: run
  grep -c 'UnsupportedOperationException("TODO: implement")' on each file you own
and it must report 0 for the file(s) listed above.`,
    { label: `impl:${m.label}`, phase: 'Implement', schema: IMPL_SCHEMA },
  ),
  (impl, m) => agent(
    `You are an INDEPENDENT ADVERSARIAL VERIFIER. Another agent claims it restored the
stubbed method bodies in a Java data-structures module. Your job is to find where
it is WRONG, and then FIX what you find.

Module:     ${m.label}
Directory:  /workspace/${m.dir}
File(s):    ${m.files}
Reference:  ${m.ref}   (decompiled from the original .class files - semantically exact)

Its self-report was:
${JSON.stringify(impl, null, 2)}

Do NOT trust that report. Verify independently:
1. grep for 'UnsupportedOperationException("TODO: implement")' in the listed
   file(s). Any hit is a hard failure - implement it.
2. Compile it yourself, into /tmp/build/verify-${m.label} (NEVER into the module
   directory - the .class files there are the reference and must stay untouched).
3. Diff the SEMANTICS of every restored method against the reference method of
   the same name, line by line. Look specifically for:
     - inverted comparisons (< vs <=, > vs >=) and off-by-one bounds
     - loop bounds that changed (i < n-1 vs i < n)
     - swapped operands, especially in subtraction, division and Math.pow,
       and in stack pop order (which operand is the left-hand side?)
     - dropped side effects: a visited[] mark, a counter increment, a parent
       pointer assignment, a field update the reference performs
     - changed or reformatted output strings, lost trailing spaces, %.2f vs %.1f,
       println vs print, missing blank lines
     - CFR artifacts left in the source (labels like block0:, "continue block3;",
       generic names like string2/arrayList/n2) - these must be gone
     - early return vs fallthrough differences
     - the "i --; continue;" style re-processing idiom being dropped
4. RUN it and check the algorithm output is actually correct, by hand. Read the
   non-stubbed main()/menu() to get the input protocol, then drive it with
   printf | timeout 20 java -cp ... . A trailing NoSuchElementException at EOF on
   an infinite menu loop is EXPECTED, not a failure.
5. Confirm no tracked data file was modified and no new file was added to the
   module directory: run  cd /workspace && git status --short -- ${m.dir}
   Only the .java file(s) listed above may appear as modified. If a data file or
   a stray output file shows up, restore it with
   git checkout -- <path>  (or delete the stray file) and report it.
6. Do not run any git command that changes committed state (no add, no commit).

FIX every real problem you find, directly in the file. Then re-compile and
re-run to confirm the fix. Report ok=true ONLY if, after your fixes, there are
zero remaining stubs, it compiles clean, behaviour matches the reference, and
the working tree is clean apart from the listed .java file(s).
List every problem you found, even the ones you fixed.`,
    { label: `verify:${m.label}`, phase: 'Verify', schema: VERIFY_SCHEMA },
  ),
)

const flat = results.filter(Boolean)
const bad = flat.filter((r) => !r.ok || r.stubsRemaining > 0)
log(`verified ok: ${flat.length - bad.length}/${MODULES.length}; needs attention: ${bad.length}`)

return {
  total: MODULES.length,
  okCount: flat.length - bad.length,
  nullResults: results.length - flat.length,
  needsAttention: bad,
  all: flat,
}
