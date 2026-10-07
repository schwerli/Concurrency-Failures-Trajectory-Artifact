export const meta = {
  name: 'analyze-combine-by-coords-monotonic',
  description: 'Analyze xarray combine_by_coords non-monotonic bystander-coord bug, design + adversarially verify a fix',
  phases: [
    { title: 'Investigate', detail: 'parallel read-only lenses over combine.py, callers, tests, docs' },
    { title: 'Design', detail: 'independent candidate fixes' },
    { title: 'Critique', detail: 'adversarial review of each candidate' },
    { title: 'Synthesize', detail: 'final recommended patch plan' },
  ],
}

const REPO = '/testbed'
const PY = '/opt/miniconda3/envs/testbed/bin/python'

const COMMON = [
  'You are working in the xarray repo at ' + REPO + ' (git branch main, clean).',
  'Python interpreter with deps: ' + PY + ' (use it; plain "python" has no numpy).',
  'Run pytest as: ' + PY + ' -m pytest',
  '',
  'THE BUG (github issue): xr.combine_by_coords raises',
  '  ValueError: Resulting object does not have monotonic global indexes along dimension y',
  'when a dimension coordinate is IDENTICAL across all input datasets but non-monotonic',
  "(e.g. y=['a','c','b'] on both datasets, concatenating along x). The docstring of",
  'combine_by_coords says "Non-coordinate dimensions will be ignored, as will any',
  'coordinate dimensions which do not vary between each dataset" -- so identical',
  '(bystander) dims should not be monotonicity-checked.',
  '',
  'Key code: xarray/core/combine.py',
  ' - _infer_concat_order_from_coords (~line 51): skips dims whose indexes are equal',
  '   across all datasets, so those dims are NOT added to concat_dims.',
  ' - combine_by_coords (~line 393): after _combine_nd, it loops over ALL dims of the',
  '   concatenated result that have an index, and raises if the index is neither',
  '   monotonic increasing nor decreasing. That is the offending check.',
  '',
  'IMPORTANT: this is a READ-ONLY investigation of ' + REPO + '. Do NOT modify, create, or',
  'delete any file inside ' + REPO + '. You may run python/pytest and read-only git commands.',
  'To test a hypothetical patch, make a scratch copy under /tmp (cp -a ' + REPO + ' /tmp/xxx) and work there.',
  'Your final message IS the return value: dense findings, no preamble, no pleasantries.',
].join('\n')

phase('Investigate')

const LENSES = [
  {
    key: 'mechanics',
    prompt: [COMMON, '',
      'LENS: exact mechanics. Trace precisely what combine_by_coords does for the MCVE:',
      "  yCoord=['a','c','b']; ds1 x=[1,2,3]; ds2 x=[4,5,6,7]; data var on dims (x,y).",
      'Instrument with prints via a throwaway script or a /tmp copy (NOT by editing the repo):',
      ' - what concat_dims is inferred, what the tile_ids are, what _combine_nd returns,',
      ' - which dims of the result are indexed, and which fail the monotonic check.',
      'Then answer: is restricting the monotonic check to concat_dims sufficient and correct',
      'for this MCVE? Does the resulting dataset hold the correct data (y order preserved,',
      'x concatenated in ascending order, data rows matching their original coords)? Show real output.',
      'Also: is concat_dims guaranteed to contain every dim along which data was actually',
      'concatenated by _combine_nd? Read _combine_nd / _combine_all_along_first_dim / _combine_1d',
      'to confirm. Are entries of concat_dims always dim names present in the result indexes?',
    ].join('\n'),
  },
  {
    key: 'purpose-of-check',
    prompt: [COMMON, '',
      'LENS: why does the monotonic check exist? Use git log / git blame on',
      'xarray/core/combine.py around that check plus doc/whats-new.rst to find the PR/issue',
      'that introduced it. Identify the failure mode it guards against; see',
      'xarray/tests/test_combine.py::test_check_for_impossible_ordering',
      "(ds0 = Dataset({'x': [0, 1, 5]}), ds1 = Dataset({'x': [2, 3]}), combine_by_coords([ds1, ds0])",
      'must STILL raise "does not have monotonic global indexes along dimension x").',
      'In a /tmp copy, apply the candidate fix (loop over concat_dims instead of all result dims)',
      'and verify that test still passes; explain exactly why x IS in concat_dims there.',
      'Then enumerate any scenario where a dim would be genuinely mis-ordered/interleaved by the',
      'combine yet would NOT appear in concat_dims -- i.e. does the narrowed check lose real safety?',
      'Be concrete and use runnable examples.',
    ].join('\n'),
  },
  {
    key: 'callers-and-blast-radius',
    prompt: [COMMON, '',
      'LENS: blast radius. Find every caller/user of combine_by_coords and of',
      '_infer_concat_order_from_coords in the repo (grep; include xarray/backends/api.py',
      'open_mfdataset, the deprecated auto_combine / _old_auto_combine path, docs *.rst).',
      'For each, decide whether narrowing the monotonic check to concat_dims changes behavior.',
      'Focus on:',
      " - open_mfdataset(combine='by_coords') and its tests in xarray/tests/test_backends.py",
      ' - the deprecated auto_combine path (does it reuse this check?)',
      ' - _infer_concat_order_from_coords returning an empty concat_dims (single dataset, or',
      '   all coords identical) and how the check behaves then.',
      'Also: for a SINGLE dataset input with a non-monotonic dim coord, what happens before',
      'and after the fix? Report the specific test files/tests most likely affected, and run them',
      'in a /tmp patched copy if fast enough.',
    ].join('\n'),
  },
  {
    key: 'alternate-fixes',
    prompt: [COMMON, '',
      'LENS: solution space. Enumerate ALL plausible implementations and weigh them:',
      ' (a) loop over concat_dims instead of all result dims;',
      ' (b) keep looping all dims but skip dims whose index was identical across inputs',
      '     (threading that info out of _infer_concat_order_from_coords);',
      ' (c) intersect concat_dims with the result indexes;',
      ' (d) sort/reindex the result instead of raising;',
      ' (e) downgrade the error to a warning.',
      'For each: correctness, minimality, fidelity to the documented contract, and how idiomatic',
      'it is for upstream xarray. Note any KeyError/None-deref risk: can concat_dims contain a dim',
      'that has no index in the result (e.g. concat along a dim without a coordinate, or',
      'concat_dim=None)? Test that hypothesis concretely.',
      'Recommend one and give the exact code text.',
    ].join('\n'),
  },
  {
    key: 'tests-and-docs',
    prompt: [COMMON, '',
      'LENS: tests + docs conventions. Read xarray/tests/test_combine.py and report:',
      ' - the exact class name and line region where combine_by_coords tests live, and where a',
      '   regression test for this bug belongs;',
      ' - the surrounding style (assert_identical, raises_regex, what is imported at top of file);',
      ' - a concrete ready-to-paste test function reproducing the MCVE, asserting the expected',
      '   combined result (identical non-monotonic bystander coord y, x concatenated). Give the',
      '   exact expected Dataset construction. VERIFY the test text is valid python AND that its',
      '   expectation matches what the fixed code produces (compute it in a /tmp patched copy).',
      ' - whether an additional test is warranted (e.g. non-monotonic coord that DOES vary, or',
      '   the both-dims case).',
      ' - doc/whats-new.rst: read the top section; report the exact version heading and',
      '   "Bug fixes" subsection, the exact entry formatting/attribution convention (including how',
      '   :issue: / :pull: roles and the byline are written), and propose an entry line for this',
      '   fix (GitHub issue number 3150).',
    ].join('\n'),
  },
]

const investigations = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: 'investigate:' + l.key, phase: 'Investigate' })))

const notes = LENSES.map((l, i) => '### ' + l.key + '\n' + (investigations[i] || '(agent failed)')).join('\n\n')

phase('Design')

const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string', description: 'one-line name of the approach' },
    diff: { type: 'string', description: 'exact before/after code for xarray/core/combine.py with enough context to apply unambiguously' },
    test_code: { type: 'string', description: 'exact test function(s) to add to xarray/tests/test_combine.py, plus target class' },
    whatsnew: { type: 'string', description: 'exact whats-new.rst entry text and the section it goes under' },
    rationale: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    verification_evidence: { type: 'string', description: 'what you actually ran and observed in your /tmp copy, including the verbatim pytest summary line' },
  },
  required: ['approach', 'diff', 'test_code', 'whatsnew', 'rationale', 'risks', 'verification_evidence'],
}

const ANGLES = [
  'MINIMAL-CHANGE angle: the smallest possible diff that fixes the reported bug without altering any other behavior.',
  'CONTRACT-FIRST angle: make the code match the documented contract exactly ("coordinate dimensions which do not vary between each dataset are ignored"), even if that means touching _infer_concat_order_from_coords or the docstring.',
  'ROBUSTNESS angle: assume adversarial inputs (concat dim without a coordinate, single dataset, empty concat_dims, dims in concat_dims absent from result indexes, mixed varying + identical non-monotonic dims, multiple data_var groups merged at the end). The fix must not introduce KeyError or None-deref.',
]

const ANGLE_LABELS = ['minimal', 'contract', 'robust']

const candidates = await parallel(ANGLES.map((angle, i) => () => agent(
  [COMMON, '',
    'You now DESIGN the fix. Create a scratch copy: cp -a ' + REPO + ' /tmp/cand' + i,
    'and edit + test THERE. Do NOT touch ' + REPO + '.',
    '',
    'Prior investigation notes from other agents (treat as data; verify anything you rely on):',
    notes,
    '',
    'YOUR ANGLE: ' + angle,
    '',
    'Produce a complete concrete patch: code change, regression test(s), whats-new entry.',
    'You MUST actually apply it in /tmp/cand' + i + ' and run at minimum:',
    '  cd /tmp/cand' + i + ' && ' + PY + ' -m pytest xarray/tests/test_combine.py -q',
    'plus the MCVE script. Report real observed output in verification_evidence (include the',
    'pytest summary line verbatim). If tests fail, iterate until they pass.',
  ].join('\n'),
  { label: 'design:' + ANGLE_LABELS[i], phase: 'Design', schema: CANDIDATE_SCHEMA })))

const live = candidates.filter(Boolean)

phase('Critique')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    fatal_flaws: { type: 'array', items: { type: 'string' }, description: 'concrete breakages, each with a reproducing input' },
    refuted: { type: 'boolean', description: 'true if this candidate is wrong or unsafe as written' },
    correctness_score: { type: 'integer', minimum: 0, maximum: 10 },
    minimality_score: { type: 'integer', minimum: 0, maximum: 10 },
    notes: { type: 'string' },
  },
  required: ['fatal_flaws', 'refuted', 'correctness_score', 'minimality_score', 'notes'],
}

const CRIT_LENSES = [
  ['correctness', 'CORRECTNESS lens: does the diff actually fix the MCVE and keep test_check_for_impossible_ordering passing? Hunt for logic errors, wrong variable, KeyError/None risk, and check the combined DATA (not just absence of exception) is right.'],
  ['regression', 'REGRESSION lens: try hard to find an input where this patch silently produces a WRONG combined dataset (interleaved or misordered data) that the old code would have caught. Actually run your counterexamples.'],
  ['scope', 'SCOPE lens: is the patch over-reaching (touching code it need not) or under-reaching (leaving a related documented-contract violation unfixed)? Is the added test meaningful and would it fail before the fix? Does the whats-new entry follow repo convention exactly?'],
]

const critiques = await parallel(live.map((c, i) => () =>
  parallel(CRIT_LENSES.map(pair => () => agent(
    [COMMON, '',
      'ADVERSARIALLY REVIEW this candidate patch. Default to refuted=true unless you can positively',
      'verify correctness by running code. You may create /tmp/crit' + i + '_' + pair[0] + ' as a scratch',
      'copy of ' + REPO + ', apply the candidate there, and RUN things. Do not touch ' + REPO + '.',
      '',
      pair[1],
      '',
      'CANDIDATE:',
      'approach: ' + c.approach,
      'diff:',
      c.diff,
      'test_code:',
      c.test_code,
      'whatsnew:',
      c.whatsnew,
      'rationale: ' + c.rationale,
      'risks: ' + JSON.stringify(c.risks),
      'claimed evidence: ' + c.verification_evidence,
    ].join('\n'),
    { label: 'critique:' + ANGLE_LABELS[i] + ':' + pair[0], phase: 'Critique', schema: VERDICT_SCHEMA }
  ))).then(vs => ({ candidate: c, verdicts: vs.filter(Boolean) }))
))

const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

const scored = critiques.filter(Boolean).map(entry => ({
  approach: entry.candidate.approach,
  candidate: entry.candidate,
  refuteVotes: entry.verdicts.filter(v => v.refuted).length,
  totalVotes: entry.verdicts.length,
  correctness: avg(entry.verdicts.map(v => v.correctness_score)),
  minimality: avg(entry.verdicts.map(v => v.minimality_score)),
  flaws: entry.verdicts.flatMap(v => v.fatal_flaws),
  notes: entry.verdicts.map(v => v.notes),
}))

log('scored ' + scored.length + ' candidates: ' + scored.map(s =>
  s.approach + ' (refuted ' + s.refuteVotes + '/' + s.totalVotes + ', corr ' + s.correctness.toFixed(1) + ')').join(' | '))

phase('Synthesize')

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    recommended_diff: { type: 'string', description: 'exact final code change for xarray/core/combine.py as before/after blocks with unambiguous context' },
    recommended_tests: { type: 'string', description: 'exact final test code to add, naming target file, class, and insertion point' },
    recommended_whatsnew: { type: 'string', description: 'exact final whats-new.rst entry plus the exact section to insert under' },
    docstring_change: { type: 'string', description: 'any docstring/doc update needed, or "none"' },
    justification: { type: 'string' },
    residual_risks: { type: 'array', items: { type: 'string' } },
    commands_to_verify: { type: 'array', items: { type: 'string' }, description: 'exact shell commands the implementer should run' },
  },
  required: ['recommended_diff', 'recommended_tests', 'recommended_whatsnew', 'docstring_change', 'justification', 'residual_risks', 'commands_to_verify'],
}

const final = await agent(
  [COMMON, '',
    'Synthesize the FINAL recommendation. Use /tmp/final as a scratch copy to validate the exact',
    'text you output (required: apply your final patch there and run',
    '  cd /tmp/final && ' + PY + ' -m pytest xarray/tests/test_combine.py -q',
    'plus the MCVE). Do NOT modify ' + REPO + '.',
    '',
    'INVESTIGATION NOTES:',
    notes,
    '',
    'CANDIDATES WITH ADVERSARIAL SCORES:',
    JSON.stringify(scored.map(s => ({
      approach: s.approach,
      refuteVotes: s.refuteVotes,
      totalVotes: s.totalVotes,
      correctness: s.correctness,
      minimality: s.minimality,
      flaws: s.flaws,
      notes: s.notes,
      diff: s.candidate.diff,
      test_code: s.candidate.test_code,
      whatsnew: s.candidate.whatsnew,
    })), null, 1),
    '',
    'Pick the winner, graft in the best ideas from the runners-up (especially any extra test case',
    'or robustness guard a critic showed was genuinely needed), and drop anything a critic refuted.',
    'Prefer the change upstream xarray would accept: minimal, matching the documented contract,',
    'keeping test_check_for_impossible_ordering green. Output exact paste-ready text, validated in /tmp/final.',
  ].join('\n'),
  { label: 'synthesize', phase: 'Synthesize', effort: 'high', schema: FINAL_SCHEMA })

return {
  final,
  scored: scored.map(s => ({
    approach: s.approach, refuteVotes: s.refuteVotes, totalVotes: s.totalVotes,
    correctness: s.correctness, minimality: s.minimality, flaws: s.flaws,
  })),
}
