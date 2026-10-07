export const meta = {
  name: 'fix-strip-accents-unicode',
  description: 'Investigate and adversarially verify a fix for strip_accents_unicode skipping already-NFKD strings',
  phases: [
    { title: 'Investigate', detail: 'call sites, edge cases, perf rationale, test/doc surface' },
    { title: 'Verify', detail: 'adversarially refute each proposed fix variant' },
    { title: 'Synthesize', detail: 'pick the fix and the test plan' },
  ],
}

const REPO = '/testbed'
const FILE = 'sklearn/feature_extraction/text.py'

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you found, concise prose' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line or command output backing the claim' },
        },
        required: ['claim', 'evidence'],
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'facts'],
}

const LENSES = [
  {
    key: 'callsites',
    prompt: `In the repo at ${REPO}, audit every caller and re-exporter of \`strip_accents_unicode\` and \`strip_accents_ascii\` in ${FILE} and anywhere else in the codebase (grep the whole tree including tests, docs/, examples/, and benchmarks).

The known bug: \`strip_accents_unicode\` short-circuits with \`if normalized == s: return s\`, so a string ALREADY in NFKD form (e.g. 'n' + U+0303 COMBINING TILDE) is returned with its combining marks intact, while the precomposed form (U+00F1) is correctly stripped to 'n'.

Report: every call site; whether any caller depends on the short-circuit's identity-return behavior; whether \`strip_accents_ascii\` has the same class of bug (analyze its NFKD + ASCII-encode path carefully); whether the \`build_preprocessor\`/\`build_analyzer\` plumbing in ${FILE} wraps these in any way that would mask or amplify the fix. Do NOT edit any files — investigation only.`,
  },
  {
    key: 'edgecases',
    prompt: `In the repo at ${REPO}, file ${FILE}, function \`strip_accents_unicode\` (around line 114).

Two candidate fixes for the "already-NFKD strings are not stripped" bug:

VARIANT A (always normalize, drop the short-circuit entirely):
    normalized = unicodedata.normalize('NFKD', s)
    return ''.join([c for c in normalized if not unicodedata.combining(c)])

VARIANT B (keep a fast path, but gate it on ASCII-ness instead of NFKD-idempotence):
    try:
        s.encode('ASCII', errors='strict')
        return s
    except UnicodeEncodeError:
        normalized = unicodedata.normalize('NFKD', s)
        return ''.join([c for c in normalized if not unicodedata.combining(c)])

Use \`python -c\` / a scratch script with the repo's python to EMPIRICALLY compare A and B against the current implementation over a wide corpus of tricky inputs. You must actually run code, not reason from memory. Cover at minimum: precomposed vs decomposed Latin (U+00F1 vs n+U+0303); the existing test corpus in sklearn/feature_extraction/tests/test_text.py::test_strip_accents and ::test_to_ascii; Arabic alef-with-hamza U+0625; CJK; Hangul (NFKD decomposes Hangul syllables into jamo — does that change output?); compatibility characters where NFKD is lossy or expanding (U+FB01 'ﬁ' ligature, U+00BD '½', U+2460 '①', U+FF21 fullwidth A, U+3392 'MHz', superscripts); characters where NFKD does something surprising (U+00DF 'ß', U+0141 'Ł', U+00D8 'Ø' — these have NO decomposition, confirm they survive); standalone combining marks with no base; empty string; pure-ASCII strings; strings with ASCII plus a combining mark (does Variant B's ASCII fast path ever wrongly return early? think hard: a combining mark is non-ASCII, so what exactly triggers UnicodeEncodeError?).

Report a table of any input where A and B DIFFER from each other, and any input where either REGRESSES relative to current behavior. Also measure rough relative performance of A vs B vs current on a pure-ASCII document corpus (the docstring warns the python loop is ~20x slower than strip_accents_ascii, so the fast path may matter). Do NOT modify any repo files; use /tmp for scratch scripts.`,
  },
  {
    key: 'history',
    prompt: `In the repo at ${REPO} (a scikit-learn checkout), establish the historical and project-convention context for fixing \`strip_accents_unicode\` in ${FILE}.

Do: \`git log -p --follow -- ${FILE}\` filtered to the strip_accents functions (and \`git log -S "normalized == s"\`) to find WHEN and WHY the \`if normalized == s: return s\` short-circuit was introduced — was it a deliberate performance optimization, or incidental? Quote the commit.

Also determine the project's conventions for this kind of change: where does the changelog live (look for doc/whats_new/ and find the version file matching the current dev version in sklearn/__init__.py), what is the exact entry format used by neighboring entries (issue/PR cross-reference syntax, the \`:mod:\`/\`:func:\` role style, contributor attribution), and which changelog section a bugfix to sklearn.feature_extraction belongs in. Quote 2-3 real neighboring entries verbatim as templates.

Finally: report how the existing \`test_strip_accents\` test is structured and whether tests in that file use pytest.mark.parametrize, so a new regression test matches local style. Do NOT edit any files — investigation only.`,
  },
]

phase('Investigate')

const investigations = await parallel(
  LENSES.map(l => () => agent(l.prompt, { label: `investigate:${l.key}`, phase: 'Investigate', schema: FINDINGS })),
)

const good = investigations.filter(Boolean)
log(`${good.length}/${LENSES.length} investigations returned`)

const brief = LENSES.map((l, i) => {
  const r = investigations[i]
  if (!r) return `### ${l.key}\n(failed)`
  const facts = (r.facts || []).map(f => `- ${f.claim}  [${f.evidence}]`).join('\n')
  const risks = (r.risks || []).map(x => `- RISK: ${x}`).join('\n')
  return `### ${l.key}\n${r.summary}\n${facts}\n${risks}`
}).join('\n\n')

phase('Verify')

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the recommended fix is wrong, incomplete, or regresses something' },
    reasoning: { type: 'string' },
    concreteCounterexample: { type: 'string', description: 'Exact input + observed vs expected output, or "none found"' },
  },
  required: ['refuted', 'reasoning', 'concreteCounterexample'],
}

const REFUTE_LENSES = [
  'correctness of the ASCII fast path: find any string where `s.encode("ASCII", strict)` succeeds yet the string still needs accent-stripping, or where it raises yet the slow path returns something wrong',
  'behavioral regression against the EXISTING test suite and public API contract: does the fix change output for any input the current code handles correctly, including non-str inputs, None, bytes, and numpy str_ scalars',
  'completeness: does fixing only `strip_accents_unicode` leave the reported bug reachable through another documented path (strip_accents="ascii", custom preprocessors, the char/char_wb analyzers), i.e. is the fix too narrow',
]

const verdicts = await parallel(
  REFUTE_LENSES.map((lens, i) => () => agent(
    `You are an adversarial reviewer. Repo: ${REPO}. File: ${FILE}.

The bug: \`strip_accents_unicode\` contains \`if normalized == s: return s\`, so strings already in NFKD form keep their combining accents.

The RECOMMENDED FIX under review (replace the body):
    try:
        # If \`s\` is ASCII-compatible, then it does not contain any accented
        # characters and we can avoid an expensive list comprehension.
        s.encode('ASCII', errors='strict')
        return s
    except UnicodeEncodeError:
        normalized = unicodedata.normalize('NFKD', s)
        return ''.join([c for c in normalized if not unicodedata.combining(c)])

Prior investigation findings:
${brief}

Your assigned lens: ${lens}

Try HARD to REFUTE this fix. You must RUN python code against the repo to test your hypotheses — do not reason from memory alone. Use /tmp for scratch files and do NOT modify repo files. Default to refuted=true if you are genuinely uncertain. If you cannot produce a concrete counterexample after real effort, set refuted=false and say so plainly.`,
    { label: `refute:${i + 1}`, phase: 'Verify', schema: VERDICT },
  )),
)

const live = verdicts.filter(Boolean)
const refutedCount = live.filter(v => v.refuted).length
log(`refutations: ${refutedCount}/${live.length}`)

phase('Synthesize')

const PLAN = {
  type: 'object',
  properties: {
    recommendedImplementation: { type: 'string', description: 'Exact final Python source for strip_accents_unicode, including docstring' },
    rationale: { type: 'string' },
    testPlan: { type: 'string', description: 'Exact pytest code to add, matching local style' },
    changelogEntry: { type: 'string', description: 'Exact rst changelog entry text plus the file path and section it goes in' },
    outstandingConcerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['recommendedImplementation', 'rationale', 'testPlan', 'changelogEntry'],
}

const plan = await agent(
  `Synthesize the final fix for the \`strip_accents_unicode\` bug in ${REPO}/${FILE}.

INVESTIGATION FINDINGS:
${brief}

ADVERSARIAL VERDICTS on the ASCII-fast-path fix (${refutedCount} of ${live.length} refuted):
${live.map((v, i) => `#${i + 1} refuted=${v.refuted}\n${v.reasoning}\nCounterexample: ${v.concreteCounterexample}`).join('\n\n')}

Produce the exact final implementation, the exact regression test code (matching the style of the existing test_strip_accents in sklearn/feature_extraction/tests/test_text.py — prefer pytest.mark.parametrize only if that matches local convention), and the exact changelog entry with its target file path and section. If any refutation stands, adjust the implementation to address it and say how. Be precise: your output will be applied verbatim. Do NOT edit files yourself.`,
  { label: 'synthesize', phase: 'Synthesize', schema: PLAN },
)

return { plan, refutedCount, total: live.length, verdicts: live, investigations: good }
