export const meta = {
  name: 'cpp-udl-research',
  description: 'Research C++ user-defined-literal grammar, Itanium mangling, and Sphinx cpp.py integration points',
  phases: [
    { title: 'Understand', detail: 'parallel readers over cfamily/cpp/tests + ABI mangling' },
    { title: 'Design', detail: 'independent implementation proposals' },
    { title: 'Judge', detail: 'score proposals and synthesize' },
  ],
}

const REPO = '/testbed'

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line or exact code/spec quote' },
        },
        required: ['claim', 'evidence'],
      },
    },
    codeSnippets: { type: 'array', items: { type: 'string' }, description: 'verbatim relevant code with file:line headers' },
  },
  required: ['summary', 'facts'],
}

phase('Understand')

const READERS = [
  {
    key: 'cfamily-regexes',
    prompt: `In ${REPO}, read sphinx/util/cfamily.py in full (it is short). Report VERBATIM:
- the exact source of identifier_re, anon_identifier_re, integer_literal_re, octal_literal_re, hex_literal_re, binary_literal_re, float_literal_re, char_literal_re (with line numbers)
- the BaseParser class: every method (match, skip_string, skip_word, skip_ws, current_char, last_match, fail, warn, etc.) with signatures and line numbers
- how \`self.match(regex)\` works and what \`self.pos\` / \`self.last_match\` mean
- any existing handling of digit separators (the ' character inside numeric literals)
- the full list of names exported / imported by sphinx/domains/cpp.py from cfamily (check the import statement in cpp.py lines 30-45)
Be exhaustive and verbatim on the regexes — I need to modify them.`,
  },
  {
    key: 'cpp-literal-parse',
    prompt: `In ${REPO}/sphinx/domains/cpp.py, study literal parsing and identifiers. Report VERBATIM with line numbers:
- \`_parse_literal\` (around line 4646) in full, and every call site of it
- \`_parse_primary_expression\` in full
- class \`ASTIdentifier\`: __init__, is_anon, get_id, _stringify, and the FULL signature + body of its \`describe_signature\` method (note the exact parameter list — it differs from other AST nodes)
- every distinct string value of the \`mode\` parameter passed to ASTIdentifier.describe_signature anywhere in the file, and how each mode is handled inside it
- how ASTIdentifier.get_id handles the version parameter and anonymous names
- class \`ASTOperatorLiteral\` or any existing support for \`operator""\` (search for 'literal' and 'operator'), and \`_parse_operator\`
Be exhaustive and verbatim.`,
  },
  {
    key: 'cpp-mangling',
    prompt: `In ${REPO}/sphinx/domains/cpp.py, study how IDs (Itanium-ABI-style mangled names) are produced for EXPRESSIONS. Report VERBATIM with line numbers:
- \`ASTPostfixCallExpr\` / any call-expression AST class and its get_id
- \`ASTBinOpExpr.get_id\`, \`ASTUnaryOpExpr.get_id\`, and the \`_id_operator_v2\` / \`_id_operator_unary_v2\` tables (just the relevant entries)
- \`ASTNumberLiteral.get_id\`, \`ASTStringLiteral.get_id\`, \`ASTCharLiteral.get_id\`, \`_id_char_from_prefix\`
- how a function call expression on a plain name is mangled (the exact format string), e.g. what \`f(1)\` produces
- search for 'clL_Z' or 'L_Z' or '_Z' in the file and report every hit with context — this is the mangling for a reference to an external function inside an expression
- \`ASTIdentifier.get_id\` exact output format (source-name: length + name?)
Be exhaustive and verbatim.`,
  },
  {
    key: 'abi-spec',
    prompt: `Answer from your knowledge of the Itanium C++ ABI mangling spec (https://itanium-cxx-abi.github.io/cxx-abi/abi.html#mangling) — do NOT search the web, just report what you know precisely:
1. How is a LITERAL OPERATOR name mangled? (i.e. \`operator"" _km\`). Give the exact production, e.g. is it \`li <source-name>\`? Quote the grammar production for <operator-name> covering literal operators.
2. How is a function CALL mangled in an <expression>? Give the production (e.g. \`cl <expression>+ E\`).
3. How is a reference to an external/global entity mangled inside an <expression>? Give the production for <expr-primary> covering \`L <mangled-name> E\`.
4. Therefore: what is the full correct mangling of the expression \`1_km\` (a user-defined-literal calling \`operator"" _km(unsigned long long)\`)? Show the assembled string step by step, e.g. cl L _Z li 3_km E L 1 E E -> "clL_Zli3_kmEL1EE". Verify the source-name length prefix is right for "_km" (3 chars).
5. What is the C++ grammar for user-defined-literal? List all four kinds (integer, floating-point, string, character) and the definition of <ud-suffix>. Include whether whitespace is allowed between the literal and the suffix (it is NOT).
6. Critically: in C++, how does a parser distinguish the standard suffix \`1ull\` / \`1.0f\` / \`1L\` from a UDL \`1_ull\`? What role does the word boundary / the requirement that ud-suffix be an identifier play? Note that \`1q_J\` in the user's example has suffix \`q_J\` which does NOT start with underscore (reserved, but syntactically an identifier).
7. Are digit separators (\`1'000\`) part of the same problem space? Where do they appear relative to the suffix?`,
  },
  {
    key: 'tests',
    prompt: `In ${REPO}/tests/test_domain_cpp.py, study how expressions are tested. Report VERBATIM with line numbers:
- the \`test_expressions\` function in full (it may be long — include all of it, especially the helper \`exprCheck\` and the literal test cases)
- how expected IDs are written and asserted
- the \`check()\` helper signature and how \`Symbol\`/parser are driven
- any existing test for character literals / number literals with suffixes
- the \`test_member_definitions\` or variable tests, to know where a case like \`constexpr auto planck = 6.62607015e-34q_J * 1q_s\` would go
Be exhaustive and verbatim for exprCheck and the literal portion of test_expressions.`,
  },
]

const research = await parallel(READERS.map(r => () =>
  agent(r.prompt, { label: `read:${r.key}`, phase: 'Understand', schema: FINDINGS })
    .then(v => ({ key: r.key, ...v }))
))

const notes = research.filter(Boolean)
log(`gathered ${notes.length}/${READERS.length} research bundles`)

const context = notes.map(n =>
  `### ${n.key}\n${n.summary}\n\nFACTS:\n${(n.facts || []).map(f => `- ${f.claim}\n  evidence: ${f.evidence}`).join('\n')}\n\nCODE:\n${(n.codeSnippets || []).join('\n\n')}`
).join('\n\n---\n\n')

phase('Design')

const PLAN = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    regexChanges: { type: 'string', description: 'exact new/changed regex source for cfamily.py' },
    astClass: { type: 'string', description: 'exact python source for the new AST class(es)' },
    parserChanges: { type: 'string', description: 'exact python source for the changed _parse_literal' },
    idMangling: { type: 'string', description: 'exact get_id output format with worked example' },
    risks: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string', description: 'exact test cases to add' },
  },
  required: ['approach', 'regexChanges', 'astClass', 'parserChanges', 'idMangling', 'risks', 'tests'],
}

const ANGLES = [
  { key: 'minimal', lens: 'Minimal-diff: change as little as possible. Keep existing suffix-consumption loop where you can. Prioritize not breaking existing tests.' },
  { key: 'spec-exact', lens: 'Spec-exact: follow the C++ standard grammar rigorously. Separate the standard integer-suffix and float-suffix into their own regexes with word boundaries so that UDL suffixes are cleanly distinguished. Handle all four UDL kinds (integer, float, string, char).' },
  { key: 'robust', lens: 'Robustness-first: think hardest about ambiguity and regressions — `1ull` vs `1_ull`, `0x1p3` vs hex-float, `1.0fq_x`, string UDLs `"abc"_s`, char UDLs `\'a\'_c`, and whether float_literal_re greedily eating digits breaks a UDL suffix that begins with e/E/p/P or f/F/l/L. Also consider digit separators.' },
]

const plans = await parallel(ANGLES.map(a => () =>
  agent(`You are designing a patch to Sphinx to add C++ user-defined-literal (UDL) support, fixing this bug:

    constexpr auto units::si::planck_constant = 6.62607015e-34q_J * 1q_s
    -> WARNING: Invalid definition: Expected end of definition. [error at 58]

Repo: ${REPO}. The relevant code is sphinx/util/cfamily.py (literal regexes) and sphinx/domains/cpp.py (_parse_literal, AST literal classes). There is a literal \`# TODO: user-defined lit\` in _parse_literal.

DESIGN LENS: ${a.lens}

Here is verified research about the current code and the ABI spec:

${context}

Produce a concrete, complete implementation plan. Give EXACT Python source for every change. Read files in the repo yourself to verify anything the research left unclear. Be specific about:
- the new AST class (name it ASTUserDefinedLiteral) with _stringify, get_id, describe_signature
- how _parse_literal detects a ud-suffix after each of the four literal kinds
- how the standard suffixes (u/U/l/L/f/F combinations) are kept working and NOT mistaken for a ud-suffix
- what mode string to pass to ASTIdentifier.describe_signature, and whether ASTIdentifier.describe_signature needs a new mode branch
- the exact get_id string for \`1_km\` and for \`6.62607015e-34q_J\`
- which existing tests could regress`,
    { label: `design:${a.key}`, phase: 'Design', schema: PLAN })
    .then(v => ({ key: a.key, ...v }))
))

const good = plans.filter(Boolean)
log(`${good.length} design proposals`)

phase('Judge')

const plansText = good.map(p => `## PROPOSAL ${p.key}\napproach: ${p.approach}\n\nregexChanges:\n${p.regexChanges}\n\nastClass:\n${p.astClass}\n\nparserChanges:\n${p.parserChanges}\n\nidMangling:\n${p.idMangling}\n\nrisks:\n${(p.risks||[]).join('\n- ')}\n\ntests:\n${p.tests}`).join('\n\n====\n\n')

const JUDGE = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: { key: {type:'string'}, score: {type:'number'}, why: {type:'string'} }, required: ['key','score','why'] } },
    winner: { type: 'string' },
    bugsFound: { type: 'array', items: { type: 'string' }, description: 'concrete defects in any proposal, with the input that breaks it' },
  },
  required: ['scores', 'winner', 'bugsFound'],
}

const LENSES = ['correctness of the C++ grammar handling and regex ambiguity', 'correctness of the Itanium ABI get_id mangling', 'regression risk against the existing test suite in tests/test_domain_cpp.py']

const verdicts = await parallel(LENSES.map((lens, i) => () =>
  agent(`Judge these competing implementation plans for adding C++ UDL support to Sphinx (repo ${REPO}).

JUDGE THROUGH THIS LENS ONLY: ${lens}

${plansText}

Be adversarial. For each proposal find concrete inputs that break it. Verify claims against the actual repo files (read them). Score 0-10 on your lens.`,
    { label: `judge:${i}`, phase: 'Judge', schema: JUDGE })
))

const SYNTH = {
  type: 'object',
  properties: {
    finalPlan: { type: 'string', description: 'the complete synthesized implementation with exact code for every file' },
    mustAvoid: { type: 'array', items: { type: 'string' } },
    testCases: { type: 'array', items: { type: 'string' } },
  },
  required: ['finalPlan', 'mustAvoid', 'testCases'],
}

const synthesis = await agent(`Synthesize the single best implementation plan for adding C++ user-defined-literal support to Sphinx (repo ${REPO}).

PROPOSALS:
${plansText}

ADVERSARIAL JUDGE VERDICTS:
${verdicts.filter(Boolean).map((v,i) => `### lens ${i}: ${LENSES[i]}\nwinner: ${v.winner}\nscores: ${v.scores.map(s=>`${s.key}=${s.score} (${s.why})`).join('; ')}\nbugs found:\n- ${(v.bugsFound||[]).join('\n- ')}`).join('\n\n')}

Take the winner as the base but graft in the best ideas from the runners-up and FIX every bug the judges found. Read the actual repo files to make sure your code is exactly correct against the real current source. Output exact final Python for each change, keyed by file path, plus the exact test cases to add.`,
  { label: 'synthesize', phase: 'Judge', schema: SYNTH })

return { synthesis, verdicts: verdicts.filter(Boolean), plans: good }
