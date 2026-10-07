export const meta = {
  name: 'predict-reference-output-format',
  description: 'Independent panel predicts the reference implementation output format for a hollowed C++ DB lab',
  phases: [
    { title: 'Predict', detail: '6 independent format predictions from repo evidence + recall' },
    { title: 'Synthesize', detail: 'consensus format spec' },
  ],
}

const FORMAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recognized_repo', 'evidence', 'query_optimize_preorder_lines', 'query_processing', 'confidence_notes'],
  properties: {
    recognized_repo: { type: 'string', description: 'If you recognize this specific lab repo from training data, name it and say what its output looked like. Otherwise "unknown".' },
    evidence: { type: 'string', description: 'Concrete evidence from the repo (constants, comments, signatures) that constrains the output format.' },
    query_optimize_preorder_lines: {
      type: 'array',
      description: 'Exact predicted stdout lines for QueryOptimize for Query 1 only (original tree then optimized tree), including the "Query 1:" header and blank lines as empty strings.',
      items: { type: 'string' },
    },
    query_processing: {
      type: 'object',
      additionalProperties: false,
      required: ['select', 'project', 'join'],
      properties: {
        select: { type: 'string', description: 'Predicted exact stdout format for the `select` command, with placeholders. Show 2-3 sample lines verbatim.' },
        project: { type: 'string' },
        join: { type: 'string', description: 'Predicted exact format for one join result tuple line printed by output(), plus any summary lines.' },
      },
    },
    confidence_notes: { type: 'string' },
  },
}

phase('Predict')
const LENSES = [
  'You are a C++ systems archaeologist. Focus on what the CODE STRUCTURE forces: the signature output(Buffer*, addr, attr1, attr2, attr3), PTR_SIZE, TUPLE_PER_BLK, HASH_PER_BLK=6, BUCKET_NUM=6, BUF_SIZE=520=8*(64+1).',
  'You have seen many Chinese university database-lab repos (数据库系统实现 / HIT / extmem.h by Zhaonian Zou). Recall how their console output is usually formatted, in English or Chinese, and whether they print counts and IO counts.',
  'You are a test author. Predict the output format that a hidden pytest suite driving this binary would most plausibly assert on, and which format is most likely to be BOTH what a reference student implementation prints AND checkable.',
  'You are a textbook purist. Predict the query-tree pre-order print format used in Elmasri/Navathe-style query-tree optimisation exercises with 4-space indentation, and how SELECT/PROJECTION/JOIN/LEAF node labels are rendered.',
  'You are a minimalist. Predict the simplest possible implementation an undergraduate would write: plain cout of numbers, minimal decoration.',
  'You are a careful reader of the requirement YAML wording (in /workspace/requirements). Derive the format from phrases like "printing a three-attribute join tuple", "reporting the final I/O count", "printing LEAF versus operator nodes with 4-space indentation".',
]

const preds = await parallel(LENSES.map((lens, i) => () => agent(
  `Read the repository at /workspace (start with lab/QueryProcessing/{file.h,extmem.h,blkio.h,main.cpp}, lab/QueryOptimize/{main.cpp,tree.h}, and /workspace/requirements/*.yaml).

All function bodies were hollowed out ("/* TODO: implement */"). A hidden test suite runs the two compiled binaries and checks their stdout. I must guess the reference implementation's stdout format.

Context I already established:
- data blocks are 64 bytes = 16 int32: 7 tuples of (int,int), then a 0 filler int, then the next-block address int (0 = end of chain).
- R(A,B): 112 tuples in blocks 0-15, A in [1,40]. S(C,D): 224 tuples in blocks 16-47, C in [20,60].
- select = "select * from R where R.A = 40 or S.C = 60" -> exactly 1 R tuple (40, 673) and 5 S tuples with C=60.
- project = "select A from R" -> 40 distinct values 1..40.
- all three joins are R.A = S.C -> 303 result tuples, each 3 attributes (A, B, D).
- QueryOptimize main() hardcodes 3 queries and prints "Query i:" then the parsed tree, then the optimised tree.

${lens}

Do NOT write any files. Return your prediction via the structured schema. Be concrete and literal: give exact character-level line formats, not descriptions.`,
  { label: `predict:${i + 1}`, phase: 'Predict', schema: FORMAT_SCHEMA }
)))

phase('Synthesize')
const valid = preds.filter(Boolean)
const synth = await agent(
  `Six independent panelists predicted the stdout format of a hollowed C++ database lab's reference implementation. Here are their predictions as JSON:

${JSON.stringify(valid, null, 2)}

Read /workspace/lab/QueryOptimize/main.cpp, /workspace/lab/QueryProcessing/main.cpp, /workspace/lab/QueryProcessing/file.h and /workspace/requirements/*.yaml yourself to arbitrate.

Produce a single CONSENSUS output-format specification I will implement. Rules for arbitration:
1. Prefer what the majority converged on.
2. Prefer formats where the numeric payload is unambiguous and greppable (a hidden test is most likely to assert on numbers and counts).
3. The format must be self-consistent across select/project/nlj/hj/smj.
4. For the query tree, give the EXACT expected stdout for all 3 queries (original + optimised), assuming: LEAF prints only its relation name; operator nodes print type plus bracketed info; indentation is 4 spaces per level.
5. Also state, for the optimiser, which relation each predicate attribute belongs to (ENAME, DNAME, ESSN) and how the code should decide.

Return plain text: a precise spec with literal example lines. No files.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { panel: valid.length, synth }
