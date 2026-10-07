export const meta = {
  name: 'blockmatrix-zero-investigation',
  description: 'Root-cause and design a fix for BlockMatrix._blockmul producing scalar Zero blocks',
  phases: [
    { title: 'Investigate', detail: 'parallel read-only probes of the root cause and blast radius' },
    { title: 'Design', detail: 'independent fix proposals' },
    { title: 'Judge', detail: 'score the proposals against risk and correctness' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'
const REPRO = `
from sympy import *
a = MatrixSymbol("a", 2, 2); z = ZeroMatrix(2, 2)
b = BlockMatrix([[a, z], [z, z]])
print(block_collapse(b * b * b))
`

phase('Investigate')

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    details: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'details'],
  additionalProperties: false,
}

const PROBES = [
  {
    key: 'rootcause',
    prompt: `You are debugging sympy at /testbed (git repo, master). Use the python at ${PY} (the "testbed" conda env) — plain \`python\` lacks mpmath.

Bug: multiplying a BlockMatrix containing ZeroMatrix blocks twice raises AttributeError: 'Zero' object has no attribute 'cols'. Repro:
${REPRO}

Trace the EXACT root cause with experiments, not guesses. Specifically answer:
1. What is the type of \`ZeroMatrix(2,2) + ZeroMatrix(2,2)\`, \`ZeroMatrix(2,2)*ZeroMatrix(2,2)\`, \`MatAdd(Z,Z).doit()\`, \`MatMul(Z,Z).doit()\`? Use type(), not repr (ZeroMatrix prints as "0").
2. Where precisely does the scalar sympy.core.numbers.Zero get produced when ImmutableDenseMatrix of blocks is multiplied? Give the exact file:line chain. Look at sympy/matrices/expressions/matadd.py rules (rm_id/unpack), sympy/strategies/rm_id, and sympy/matrices/expressions/matexpr.py get_postprocessor.
3. Is \`ZeroMatrix.is_zero\` True? Does sympy.core.add.Add.flatten drop args whose is_zero is True BEFORE the matrix postprocessor runs? Prove it experimentally.
4. Confirm whether BlockMatrix.__new__ (the regularity check added recently) now rejects the product matrix, so even b._blockmul(b) fails on current master (unlike sympy 1.4 in the report).

Report the definitive causal chain, quoting real file:line. Do not modify any files.`,
  },
  {
    key: 'upstream',
    prompt: `Repo /testbed is sympy at master (~Sept 2019, just before 1.5). Use ${PY} for python.

Task: find how this class of bug is handled elsewhere in the codebase, and what the codebase's own conventions suggest for a fix. Read (do not modify):
- sympy/matrices/expressions/matadd.py (rules tuple, rm_id, validate)
- sympy/matrices/expressions/matmul.py (any_zeros, remove_ids, rules)
- sympy/matrices/expressions/matexpr.py (ZeroMatrix, GenericZeroMatrix, get_postprocessor, MatrixExpr.__add__/__mul__, is_zero related properties)
- sympy/strategies/rl.py (rm_id, unpack) and sympy/strategies/core.py
- sympy/matrices/expressions/blockmatrix.py (BlockMatrix.__new__, _blockmul, _blockadd, colblocksizes, rowblocksizes, bc_matmul, block_collapse)

Answer:
1. Does \`unpack\`/\`rm_id\` in matadd's rules tuple correctly preserve identity when ALL args are removed? What does MatAdd() with zero args evaluate to? Is GenericZeroMatrix the intended identity, and does the identity survive .doit()?
2. Is there existing precedent of a "flatten/unpack must not lose the matrix type" guard anywhere?
3. Enumerate every existing test that asserts on ZeroMatrix arithmetic types or on BlockMatrix products, with file:line, so a fix can be checked against them. Grep for ZeroMatrix in sympy/matrices/expressions/tests/.
Report concisely with file:line references.`,
  },
  {
    key: 'blast',
    prompt: `Repo /testbed is sympy. Use ${PY} for python (plain python lacks mpmath).

A candidate fix is to make MatAdd/MatMul of ZeroMatrix return a ZeroMatrix (a MatrixExpr) instead of collapsing to scalar sympy.core.numbers.Zero. Another candidate is to make BlockMatrix._blockmul / _blockadd sanitize the resulting block matrix, converting any scalar Zero entries back into ZeroMatrix of the right shape.

Your job: map the BLAST RADIUS of each. Read-only.
1. Grep the whole sympy tree for code that relies on ZeroMatrix arithmetic collapsing to scalar Zero — e.g. \`== 0\`, \`is S.Zero\`, \`is_zero\`, \`.is_ZeroMatrix\` checks on results of matrix Add/Mul. Report the risky call sites with file:line.
2. Find all tests (doctests included) that would change behavior if \`ZeroMatrix(2,2) + ZeroMatrix(2,2)\` returned ZeroMatrix(2,2) instead of Zero. Grep sympy/matrices/expressions/tests/ and sympy/matrices/tests/, and any doctests in matexpr.py/matadd.py/matmul.py/blockmatrix.py.
3. Check sympy/matrices/expressions/matexpr.py ZeroMatrix.is_zero and whether Add.flatten's zero-dropping is the mechanism. Report whether changing is_zero is safe or wide-reaching.
Report a ranked risk list with file:line.`,
  },
  {
    key: 'scope',
    prompt: `Repo /testbed is sympy. Use ${PY} for python.

Explore the FULL scope of the reported bug beyond the headline repro, so a fix can cover all of it. Read-only; run experiments in a scratch python process (do not write files into the repo).

Test and report the current behavior (type + value, using type() since ZeroMatrix prints as "0") of:
1. \`block_collapse(b*b)\`, \`b._blockmul(b)\` where b = BlockMatrix([[a, z], [z, z]]) with a = MatrixSymbol('a',2,2), z = ZeroMatrix(2,2).
2. The same with NON-SQUARE / mismatched block sizes, e.g. blocks of differing shapes, so a fix that reconstructs ZeroMatrix must infer correct rows/cols per block position.
3. \`b._blockadd(b)\` — does addition hit the same problem?
4. BlockMatrix with Identity blocks; BlockDiagMatrix products (\`BlockDiagMatrix(a, b)._blockmul(...)\`); does BlockDiagMatrix hit this too?
5. Transpose/inverse paths on such block matrices.
6. What SHOULD the correct answer for block_collapse(b*b*b) be?

Crucially: for a fix that rebuilds ZeroMatrix blocks, what are the correct row/col sizes for block (i,j) of the product, and can they always be recovered from the two operand BlockMatrices (self.rowblocksizes[i], other.colblocksizes[j])? Verify with a non-square example.
Report concretely with the experiment outputs.`,
  },
]

const probes = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Investigate', schema: FINDINGS_SCHEMA })))

const context = PROBES.map((p, i) => `### ${p.key}\n${probes[i] ? probes[i].summary + '\n\n' + probes[i].details : '(no result)'}`).join('\n\n')

phase('Design')

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    diff: { type: 'string', description: 'exact code changes with file:line and before/after snippets' },
    risks: { type: 'string' },
    tests: { type: 'string' },
  },
  required: ['approach', 'diff', 'risks', 'tests'],
  additionalProperties: false,
}

const ANGLES = [
  { key: 'local', lens: 'Fix it LOCALLY in blockmatrix.py only: _blockmul/_blockadd sanitize the resulting block Matrix, converting scalar Zero entries back to ZeroMatrix with the correct shape derived from rowblocksizes/colblocksizes. Minimal blast radius. Consider whether BlockMatrix.__new__ should also tolerate scalar zeros.' },
  { key: 'core', lens: 'Fix it at the ROOT in matadd.py/matexpr.py: make MatAdd of ZeroMatrices return a ZeroMatrix rather than scalar Zero (e.g. ZeroMatrix.is_zero, or the rm_id/unpack rules, or the Add postprocessor). Argue why this is the semantically correct fix and quantify the breakage.' },
  { key: 'hybrid', lens: 'Propose the smallest change that fixes the reported bug WITHOUT changing global ZeroMatrix arithmetic semantics, but that also makes BlockMatrix robust to any scalar-zero blocks arriving from anywhere. Think about what the sympy maintainers would actually merge for this issue.' },
]

const designs = await parallel(ANGLES.map(a => () =>
  agent(`You are a sympy core developer. Repo /testbed, python at ${PY}.

BUG: block_collapse(b*b*b) raises AttributeError: 'Zero' object has no attribute 'cols' for b = BlockMatrix([[a, z], [z, z]]), because block products turn ZeroMatrix blocks into scalar Zero.

INVESTIGATION FINDINGS FROM PARALLEL PROBES:
${context}

YOUR ASSIGNED ANGLE: ${a.lens}

Produce a concrete, complete proposal. You MAY experiment by editing files to test your idea, but you MUST \`git checkout --\` / restore /testbed to a pristine state before returning (verify with \`git status --porcelain\` — it must be clean). Report the exact diff as text, not as a left-behind edit.

Requirements the fix must satisfy:
- block_collapse(b*b*b) works and gives the mathematically correct answer
- b._blockmul(b)._blockmul(b) works
- non-square block shapes are handled (correct ZeroMatrix dimensions)
- the existing test suite still passes: run \`${PY} -m pytest sympy/matrices/expressions/tests/ -x -q\` and report the result of your experiment
Include the new tests you would add.`, { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA })))

phase('Judge')

const proposals = ANGLES.map((a, i) => `## Proposal ${a.key}\n${designs[i] ? `APPROACH: ${designs[i].approach}\n\nDIFF:\n${designs[i].diff}\n\nRISKS: ${designs[i].risks}\n\nTESTS: ${designs[i].tests}` : '(failed)'}`).join('\n\n---\n\n')

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'string' } },
    winner: { type: 'string' },
    rationale: { type: 'string' },
    grafts: { type: 'string', description: 'best ideas from the losing proposals to fold into the winner' },
    finalRecommendation: { type: 'string', description: 'the exact recommended change, file:line + code' },
  },
  required: ['ranking', 'winner', 'rationale', 'grafts', 'finalRecommendation'],
  additionalProperties: false,
}

const LENSES = ['correctness — does it actually produce mathematically right results in all block-shape cases',
                'regression risk — how much existing sympy behavior changes, judged against the real test suite',
                'maintainability — would a sympy maintainer merge this; is it at the right layer of abstraction']

const verdicts = (await parallel(LENSES.map(l => () =>
  agent(`You are judging three candidate fixes for a sympy bug. Repo /testbed, python ${PY}.

BUG: block_collapse(BlockMatrix([[a,z],[z,z]])**3-ish) raises AttributeError: 'Zero' object has no attribute 'cols'.

${proposals}

Judge STRICTLY through this lens: ${l}

You may verify claims by reading /testbed source and running experiments (restore the repo to clean with git checkout if you edit anything; verify \`git status --porcelain\` is empty before returning). Be skeptical — check whether each proposal's claimed test-suite pass is plausible, and whether its shape inference is actually correct for non-square blocks.

Rank all three, pick a winner, and state exactly what the final change should be.`,
    { label: `judge:${l.split(' ')[0]}`, phase: 'Judge', schema: JUDGE_SCHEMA })))).filter(Boolean)

return { probes: probes.filter(Boolean), designs: designs.filter(Boolean), verdicts }
