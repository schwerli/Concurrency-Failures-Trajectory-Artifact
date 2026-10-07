export const meta = {
  name: 'investigate-autowrap-array-args',
  description: 'Investigate sympy codegen bug where array args absent from expr lose their dimensions',
  phases: [
    { title: 'Investigate', detail: 'parallel readers over codegen backends, autowrap, tests' },
    { title: 'Verify', detail: 'adversarially check each claim against the source' },
    { title: 'Synthesize', detail: 'produce a single fix design' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you found, concisely' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          evidence: { type: 'string', description: 'verbatim code snippet supporting the claim' },
        },
        required: ['claim', 'file', 'line', 'evidence'],
      },
    },
  },
  required: ['summary', 'claims'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    supported: { type: 'boolean' },
    correction: { type: 'string', description: 'If not supported, what is actually true. Empty if supported.' },
    note: { type: 'string' },
  },
  required: ['supported', 'correction', 'note'],
}

const REPO = '/testbed'

const LENSES = [
  {
    key: 'c-routine-path',
    prompt: `In the sympy repo at ${REPO}, read sympy/utilities/codegen.py carefully, focusing on \`CodeGen.routine\` (around lines 577-745).

Trace EXACTLY what happens for this call:
  x = MatrixSymbol('x', 2, 1); expr = 1.0
  codegen(('autofunc', expr), 'C', argument_sequence=(x,))
i.e. \`CodeGen.routine('autofunc', 1.0, argument_sequence=(x,), global_vars=None)\`

Answer precisely:
1. What is \`expressions.free_symbols\` here? What ends up in \`symbols\`?
2. What does the \`array_symbols\` dict contain? (note it's built from \`expressions.atoms(Indexed)\` / \`atoms(MatrixSymbol)\`)
3. What happens in the \`argument_sequence is not None\` block? Which branch does \`x\` take (the \`name_arg_dict[symbol]\` hit or the \`KeyError\` fallback)?
4. Exactly which line creates the wrong \`InputArgument\` (no dimensions)?
5. What are ALL the constructor kwargs \`InputArgument\`/\`Argument\` accepts, and what does \`dimensions\` need to look like (list of (lower, upper) tuples)?
6. Does \`Argument.__init__\` do anything special with MatrixSymbol names? Read \`Argument.__init__\` (around line 289-340) in full and report how \`name\`, \`datatype\`, \`dimensions\` are derived.

Also: check whether \`Routine.__init__\`'s validation (lines ~160-200) would complain about an unused MatrixSymbol arg.

Report claims with exact file:line and verbatim evidence.`,
  },
  {
    key: 'other-backends',
    prompt: `In the sympy repo at ${REPO}, read sympy/utilities/codegen.py and find EVERY \`routine()\` method (there are several: CodeGen/CCodeGen base, FCodeGen, JuliaCodeGen, OctaveCodeGen, RustCodeGen — grep for "def routine").

For each one:
1. Report its line range and which class it belongs to.
2. Does it have the same \`argument_sequence\` fallback pattern that creates a bare \`InputArgument(symbol)\` on KeyError, thereby dropping dimensions for MatrixSymbol/IndexedBase args not present in the expression? Quote the exact lines.
3. Does it build an \`array_symbols\` dict? From what (\`expressions.atoms(...)\` only, or also from argument_sequence)?
4. Would each backend be affected by the same bug? Explain per backend.

Also grep the whole repo for other places that construct \`InputArgument(\` and report each with file:line and whether dimensions are passed.

Report claims with exact file:line and verbatim evidence.`,
  },
  {
    key: 'autowrap-cython',
    prompt: `In the sympy repo at ${REPO}, read sympy/utilities/autowrap.py.

1. Trace \`autowrap(expr, args=(x,), backend='cython')\` — how does \`args\` become \`argument_sequence\`? Quote the code path (CodeWrapper, CythonCodeWrapper, \`_process_files\`, \`dump_pyx\`, etc.) with file:line.
2. In \`CythonCodeWrapper\`, how are argument declarations/types generated? Find \`_prototype_arg\`, \`_declare_arg\`, \`_call_arg\` (or similarly named) and quote them. How do they branch on \`arg.dimensions\`?
3. Confirm: if an \`InputArgument\` for a MatrixSymbol has \`dimensions=None\`, what pyx/C signature results? Show the exact string produced.
4. Is there anywhere in autowrap.py that ALSO needs fixing, or is fixing codegen.py's routine() sufficient? Consider \`ufuncify\`, the f2py backend, and \`_partition_args\` / helper routines if present.

Report claims with exact file:line and verbatim evidence.`,
  },
  {
    key: 'tests-and-conventions',
    prompt: `In the sympy repo at ${REPO}:

1. Read sympy/utilities/tests/test_codegen.py — find existing tests involving \`argument_sequence\` and MatrixSymbol / IndexedBase. Report the naming conventions and assertion style used (e.g. \`assert source == expected\`). Quote 1-2 representative full test functions so I can match the style exactly.
2. Read sympy/utilities/tests/test_autowrap.py — find how cython-backend tests are written, especially any that only check generated code (not requiring a compiler). Look for \`test_cython_wrapper_*\` style tests and quote 2 representative ones in full.
3. Are there tests in sympy/external/tests/test_autowrap.py that require an actual compiler? How are they skipped?
4. Find any test that would break if \`InputArgument\` for unused MatrixSymbol args suddenly gained dimensions. Grep for tests asserting exact generated C/Fortran signatures with unused args.
5. What is the exact expected C signature format that CCodeGen produces for a MatrixSymbol arg WITH dimensions? Find a test or run a small snippet to show it.

Report claims with exact file:line and verbatim evidence.`,
  },
  {
    key: 'empirical',
    prompt: `In the sympy repo at ${REPO}, EMPIRICALLY reproduce and characterize the bug by running python snippets (use \`python -c\` or write temp scripts under /tmp). The repo is an editable sympy install; verify with \`python -c "import sympy; print(sympy.__file__)"\`.

Run at least these and report ACTUAL output verbatim:

A) Baseline broken case — print generated C:
\`\`\`python
from sympy.utilities.codegen import codegen
from sympy import MatrixSymbol
x = MatrixSymbol('x', 2, 1)
print(codegen(('autofunc', 1.0), 'C', 'file', argument_sequence=(x,))[0][1])
\`\`\`

B) Working case (expr depends on x): replace \`1.0\` with \`x[0,0]\` and print.

C) Same for 'F95', 'Julia', 'Octave', 'Rust' backends — which produce wrong signatures?

D) Cython wrapper output without compiling. Try:
\`\`\`python
from sympy.utilities.autowrap import CythonCodeWrapper
from sympy.utilities.codegen import make_routine, CCodeGen
from sympy import MatrixSymbol
import io
x = MatrixSymbol('x', 2, 1)
r = make_routine('autofunc', 1.0, argument_sequence=(x,))
print([ (a.name, a.dimensions) for a in r.arguments ])
w = CythonCodeWrapper(CCodeGen())
out = io.StringIO(); w.dump_pyx([r], out, 'file'); print(out.getvalue())
\`\`\`
(adjust API as needed by reading the source; report the real API you used)

E) An IndexedBase variant:
\`\`\`python
from sympy import symbols, IndexedBase, Idx
from sympy.utilities.codegen import codegen
n = 3
a = IndexedBase('a', shape=(n,))
print(codegen(('f', 1.0), 'C', 'f', argument_sequence=(a,))[0][1])
\`\`\`
Does IndexedBase suffer the same bug? What about \`a\` passed as the IndexedBase vs \`a.label\`?

F) Check whether \`make_routine\` with argument_sequence containing a MatrixSymbol that IS in the expr gives dimensions — confirm the contrast.

G) Is a C/C++ compiler and cython available in this environment? Run \`which gcc cc\` and \`python -c "import cython; print(cython.__version__)"\` and \`python -c "import numpy; print(numpy.__version__)"\`. Report so we know if an end-to-end autowrap test can run.

Report every command and its verbatim output.`,
  },
]

phase('Investigate')

const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `probe:${l.key}`, phase: 'Investigate', schema: FINDINGS_SCHEMA }),
  (res, lens) => {
    if (!res || !res.claims || !res.claims.length) return { lens: lens.key, summary: res ? res.summary : '(agent failed)', claims: [] }
    return parallel(res.claims.slice(0, 12).map(c => () =>
      agent(`You are an adversarial verifier working in the sympy repo at ${REPO}.

A prior agent claimed:
  CLAIM: ${c.claim}
  LOCATION: ${c.file}:${c.line}
  EVIDENCE THEY GAVE: ${c.evidence}

Independently check this against the ACTUAL source on disk (Read the file at that location; also run python if the claim is about runtime behavior). Try to REFUTE it. Line numbers may be slightly off — if the claimed code exists nearby, that's fine; judge the substance, not the exact line. Set supported=false only if the substance is wrong or the code does not exist. If false, say what is actually true.`,
        { label: `verify:${lens.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ ...c, verdict: v }))
    )).then(verified => ({ lens: lens.key, summary: res.summary, claims: verified.filter(Boolean) }))
  }
)

phase('Synthesize')

const dossier = results.filter(Boolean).map(r => {
  const good = r.claims.filter(c => c.verdict && c.verdict.supported)
  const bad = r.claims.filter(c => c.verdict && !c.verdict.supported)
  return `### Lens: ${r.lens}
SUMMARY: ${r.summary}

CONFIRMED CLAIMS:
${good.map(c => `- [${c.file}:${c.line}] ${c.claim}\n  evidence: ${c.evidence}\n  verifier note: ${c.verdict.note}`).join('\n') || '(none)'}

REFUTED / CORRECTED CLAIMS:
${bad.map(c => `- [${c.file}:${c.line}] ${c.claim}\n  CORRECTION: ${c.verdict.correction}`).join('\n') || '(none)'}`
}).join('\n\n')

log('Synthesizing fix design from ' + results.filter(Boolean).length + ' lenses')

const design = await agent(`You are designing the minimal, correct fix for a sympy bug, working in ${REPO}.

BUG REPORT (from the user):
autowrap with the cython backend fails when array arguments (MatrixSymbol) do not appear in the wrapped expression. \`autowrap(1.0, args=(MatrixSymbol('x',2,1),), backend='cython')\` generates \`double autofunc(double x)\` instead of \`double autofunc(double *x)\`, so calling it raises "TypeError: only size-1 arrays can be converted to Python scalars". It works fine when the expression depends on every argument.

INVESTIGATION DOSSIER (claims already adversarially verified):
${dossier}

Now produce the fix design. Read the actual source at ${REPO}/sympy/utilities/codegen.py yourself to confirm before writing the design. Requirements:
- Fix must handle MatrixSymbol AND IndexedBase args in \`argument_sequence\` that are absent from the expression.
- Consider whether ALL backends' \`routine()\` methods need the fix or only the base \`CodeGen.routine\`. Be explicit per backend, and say whether fixing only the base class is the right scope (i.e. the minimal upstream-PR-shaped change) or whether other backends must change too.
- Must not regress existing tests.
- Prefer the smallest change that matches surrounding style. Reuse the existing dimension-computation logic rather than duplicating it if reasonable.
- Say exactly what the new/changed code should be (give the literal replacement code), and what tests to add (file + test name + what they assert), matching the repo's existing test style.

Return a clear markdown design doc: (1) root cause with file:line, (2) exact code change(s) with before/after, (3) per-backend scope decision with reasoning, (4) tests to add, (5) regression risks to check.`,
  { label: 'synthesize-design', phase: 'Synthesize' })

return { design, dossier }
