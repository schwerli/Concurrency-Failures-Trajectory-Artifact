export const meta = {
  name: 'tuple-unparse-fix',
  description: 'Investigate 1-element tuple unparse bug in sphinx/pycode/ast.py and its ripple effects',
  phases: [
    { title: 'Investigate', detail: 'consumers, subscript interaction, test surface' },
    { title: 'Verify', detail: 'adversarially check each claim' },
  ],
}

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          impact: { type: 'string' },
        },
        required: ['claim', 'file', 'impact'],
      },
    },
  },
  required: ['summary', 'claims'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const LENSES = [
  {
    key: 'consumers',
    prompt: `In the /testbed repo (Sphinx), sphinx/pycode/ast.py has visit_Tuple which renders (1,) as (1) — dropping the trailing comma for single-element tuples. Find EVERY consumer of sphinx.pycode.ast.unparse (and of ast_unparse aliases) across sphinx/ and tests/. For each, state whether a single-element tuple could reach it and what the user-visible output would be (e.g. autodoc signature default values, type annotations, attribute values). Report concrete file:line. Do not change any files.`,
  },
  {
    key: 'subscript',
    prompt: `In the /testbed repo (Sphinx), read sphinx/pycode/ast.py visit_Subscript and its is_simple_tuple helper, plus visit_Tuple. Question: if visit_Tuple is fixed to emit "(1,)" for single-element tuples, does visit_Subscript still render subscripts correctly? Specifically check what these unparse to before and after such a fix by actually running python in /testbed: "Tuple[int]", "Tuple[int, str]", "Tuple[()]", "x[1,]", "x[1, 2]", "Dict[str, int]", "Callable[[int], None]", "x[:, 1]", "x[*a]" (3.11+ only). Report actual observed strings via a python one-liner using sphinx.pycode.ast.unparse. Note the python version. Report whether is_simple_tuple path shields subscripts from the change. Do not change any files.`,
  },
  {
    key: 'tests',
    prompt: `In the /testbed repo (Sphinx), find every test that asserts on the rendering of a tuple through sphinx.pycode.ast.unparse or through autodoc/signature machinery that would include a tuple. Grep tests/ for tuple literals in expected strings, e.g. "(1, 2, 3)", "()", "(1,)", and any autodoc test with a tuple default argument or tuple attribute value. Also check sphinx/ext/autodoc/ tests and roots for tuple defaults. Report file:line and the exact expected string, so we know which tests would need updating if single-element tuples gain a trailing comma. Do not change any files.`,
  },
  {
    key: 'upstream',
    prompt: `In the /testbed repo (Sphinx), inspect git history for the prior related fix: "git log --oneline --all -S'is_simple_tuple' -- sphinx/pycode/ast.py" and "git log -p --oneline -20 -- sphinx/pycode/ast.py". The bug report references issue #7964 fixed by PR #8265 and this followup concerns 1-element tuples. Summarize what #8265 changed and what conventions the codebase follows (e.g. CHANGES file entry format for bugfixes — read the top of /testbed/CHANGES and report the exact section heading and version currently under development, and whether a Bugs fixed entry should be added). Do not change any files.`,
  },
]

phase('Investigate')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `investigate:${l.key}`, phase: 'Investigate', schema: FINDINGS }),
  (res, item) => {
    if (!res || !res.claims || !res.claims.length) return { key: item.key, summary: res?.summary || '', claims: [] }
    return parallel(res.claims.map(c => () =>
      agent(`In /testbed (Sphinx repo), adversarially verify this claim by reading the actual code and running python if needed. Claim: "${c.claim}" (at ${c.file}${c.line ? ':' + c.line : ''}, stated impact: ${c.impact}). Try to REFUTE it. Default to refuted=true if you cannot confirm it from the actual files. Do not change any files.`,
        { label: `verify:${item.key}`, phase: 'Verify', schema: VERDICT })
        .then(v => ({ ...c, verdict: v }))
    )).then(vs => ({ key: item.key, summary: res.summary, claims: vs.filter(Boolean) }))
  }
)

const out = results.filter(Boolean)
return {
  byLens: out.map(r => ({
    lens: r.key,
    summary: r.summary,
    confirmed: r.claims.filter(c => c.verdict && !c.verdict.refuted).map(c => ({ claim: c.claim, file: c.file, line: c.line, impact: c.impact })),
    refuted: r.claims.filter(c => c.verdict && c.verdict.refuted).map(c => ({ claim: c.claim, why: c.verdict.reason })),
  })),
}
