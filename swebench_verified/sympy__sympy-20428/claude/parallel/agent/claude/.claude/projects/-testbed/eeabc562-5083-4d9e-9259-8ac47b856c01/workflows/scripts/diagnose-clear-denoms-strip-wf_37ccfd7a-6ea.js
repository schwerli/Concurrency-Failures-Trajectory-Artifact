export const meta = {
  name: 'diagnose-clear-denoms-strip',
  description: 'Investigate the unstripped-DMP bug from Poly.clear_denoms and design the minimal correct fix',
  phases: [
    { title: 'Investigate', detail: 'parallel probes: mechanism, callers, tests, alternatives' },
    { title: 'Verify', detail: 'adversarially check each proposal for breakage' },
    { title: 'Synthesize', detail: 'pick the fix and enumerate tests' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

const CONTEXT = [
  'Repo: /testbed (sympy, branch master). Python interpreter WITH deps: ' + PY,
  'Run tests like: ' + PY + ' -m pytest sympy/polys/tests/test_densetools.py -q',
  '',
  'THE BUG (already reproduced):',
  'Poly.clear_denoms() on a constant EX-domain Poly whose value is actually 0 (but whose EX coefficient',
  'does not simplify to 0 until multiplied by the common denominator) returns a Poly whose underlying',
  'DMP is UNSTRIPPED: DMP([EX(0)], EX, None) instead of DMP([], EX, None).',
  '',
  'Consequences: bad_poly.is_zero is False while bad_poly.as_expr().is_zero is True;',
  'bad_poly.terms_gcd() raises IndexError from monomial_min; historically bad_poly.primitive()',
  'raised ZeroDivisionError (sympy issues #17990, #20428).',
  '',
  'Root mechanism (already established -- sanity-check it, do not re-derive from scratch):',
  '- input rep is [EX(<nonzero-looking expr>)] -- length 1, leading coeff truthy',
  '- sympy/polys/densetools.py dup_clear_denoms does: f = dup_mul_ground(f, common, K0)',
  '- dup_mul_ground (sympy/polys/densearith.py) does a list comprehension with NO strip, so the',
  '  coefficient becomes EX(0) but the list keeps length 1.',
  '- dmp_clear_denoms (same file) is the multivariate analogue using dmp_mul_ground + _rec_clear_denoms.',
  '- DMP.__init__ and DMP.per do not strip.',
  '',
  'To reproduce, write this to /tmp/repro_<yourlabel>.py and run it with ' + PY + ':',
  '',
  'from sympy import *',
  'x = symbols("x")',
  'e = sympify("-117968192370600*18**(1/3)/(217603955769048*(24201 + 253*sqrt(9165))**(1/3) + 2273005839412*sqrt(9165)*(24201 + 253*sqrt(9165))**(1/3)) - 15720318185*2**(2/3)*3**(1/3)*(24201 + 253*sqrt(9165))**(2/3)/(217603955769048*(24201 + 253*sqrt(9165))**(1/3) + 2273005839412*sqrt(9165)*(24201 + 253*sqrt(9165))**(1/3)) + 15720318185*12**(1/3)*(24201 + 253*sqrt(9165))**(2/3)/(217603955769048*(24201 + 253*sqrt(9165))**(1/3) + 2273005839412*sqrt(9165)*(24201 + 253*sqrt(9165))**(1/3)) + 117968192370600*2**(1/3)*3**(2/3)/(217603955769048*(24201 + 253*sqrt(9165))**(1/3) + 2273005839412*sqrt(9165)*(24201 + 253*sqrt(9165))**(1/3))")',
  'f = Poly(e, x)',
  'coeff, bad = f.clear_denoms()',
  'print(repr(bad.rep), bad.is_zero)',
].join('\n')

phase('Investigate')

const PROBES = [
  {
    key: 'mechanism',
    prompt: [CONTEXT, '',
      'Your job: verify the root mechanism EXACTLY and characterize the blast radius of unstripped DMPs.',
      '',
      '1. Read sympy/polys/densetools.py dup_clear_denoms + _rec_clear_denoms + dmp_clear_denoms, and',
      '   sympy/polys/densearith.py dup_mul_ground/dmp_mul_ground, and sympy/polys/densebasic.py',
      '   dup_strip/dmp_strip/dmp_zero_p/dmp_ground_p.',
      '2. Confirm experimentally where the unstripped list is produced (instrument with a temp script in /tmp,',
      '   never by editing repo files).',
      '3. Determine whether the MULTIVARIATE path (dmp_clear_denoms with u>0) has the same defect, and',
      '   construct a concrete failing multivariate example if possible (EX domain, e.g. Poly in x,y).',
      '   Report the exact reproducing snippet and its real output, or state clearly that you could not',
      '   build one and why.',
      '4. Determine whether the bug also occurs via DMP.clear_denoms (sympy/polys/polyclasses.py) and via',
      '   PolyElement.clear_denoms in sympy/polys/rings.py and sympy/polys/fields.py if those exist. Grep',
      '   for all definitions and uses of clear_denoms in the repo and list them with file:line.',
      '5. Determine whether other operations in the same family produce unstripped DMPs with EX (mul_ground,',
      '   quo_ground, exquo_ground, terms_gcd, primitive, monic, diff, integrate). Test empirically.',
      '',
      'Return a precise technical report with file:line refs, verified snippets and their real output.',
    ].join('\n'),
  },
  {
    key: 'callers',
    prompt: [CONTEXT, '',
      'Your job: map every caller/consumer of clear_denoms (all layers) and assess the impact of making it',
      'return a properly STRIPPED representation (so the zero poly becomes DMP([], ...) and is_zero is True).',
      '',
      '1. Grep the whole repo for clear_denoms (dup_clear_denoms, dmp_clear_denoms, DMP.clear_denoms,',
      '   Poly.clear_denoms, rat_clear_denoms) and list every call site with file:line and a one-line note',
      '   on what it does with the result.',
      '2. For each call site, judge: would receiving a stripped (truly zero) poly instead of an unstripped',
      '   pseudo-zero change behavior? Flag anything that relies on len(rep) or degree() of the result.',
      '3. Pay special attention to sympy/polys/polytools.py (around lines 5537 and 7044), groebnertools,',
      '   sympy/polys/numberfields.py, sympy/polys/rootoftools.py, sympy/solvers, and any',
      '   clear_denoms(convert=True) call.',
      '4. Investigate what the returned coefficient should be for a zero polynomial. Empirically check what',
      '   Poly(0, x, domain=QQ).clear_denoms() returns today, and what Poly(0, x, domain=EX).clear_denoms()',
      '   returns. Report whether the buggy case returning the big denominator as coeff (instead of 1) is',
      '   also a defect worth fixing, or acceptable/out of scope.',
      '',
      'Return a table-like report with file:line, risk (none/low/high), and reasoning. Verify by reading code.',
    ].join('\n'),
  },
  {
    key: 'tests',
    prompt: [CONTEXT, '',
      'Your job: inventory the EXISTING test coverage, record the CURRENT test baseline, and propose exact',
      'new tests for this fix.',
      '',
      '1. Find all existing tests touching clear_denoms: grep sympy/polys/tests/ and elsewhere. List',
      '   file:line and what each asserts. Read the clear_denoms tests in test_densetools.py and',
      '   test_polytools.py verbatim (names may differ).',
      '2. Note the test style/conventions in each file: how rings are constructed, whether assertions are',
      '   made on .rep, use of R, x = ring(...) style, use of DMP(...) literals.',
      '3. Propose concrete new test code (copy-pasteable, matching local style) that FAILS before the fix',
      '   and PASSES after, covering:',
      '   - the exact issue repro: Poly.clear_denoms on that giant EX constant -> is_zero True and',
      '     rep equal to DMP([], EX, None)',
      '   - a SMALLER/FASTER synthetic EX example if you can find one. Try hard: an EX coefficient that is',
      '     a nonzero-looking expression which cancels when multiplied by the common denominator. Ideas to',
      '     actually test: 1/(sqrt(2)+1) - (sqrt(2)-1); combinations of cube roots like the issue; sums of',
      '     radicals that do not auto-simplify. Report the actual snippet tried and its real output.',
      '   - terms_gcd() and primitive() on the result behaving like the zero poly',
      '   - the multivariate case if it is also broken',
      '4. Identify which existing tests might BREAK if clear_denoms starts stripping. RUN the polys test',
      '   suite subset NOW to record the baseline (pass/fail counts) for test_densetools.py,',
      '   test_polytools.py, test_polyclasses.py. Report exact commands and results.',
      '',
      'Do not edit repo source files. Return the inventory, the baseline, and the proposed test code.',
    ].join('\n'),
  },
  {
    key: 'alternatives',
    prompt: [CONTEXT, '',
      'Your job: enumerate and evaluate the candidate FIX locations. For each, write the exact patch',
      '(before/after snippet with file:line) and argue correctness, performance, and blast radius.',
      '',
      'Candidates (add better ones if you find them):',
      'A. Strip in dup_clear_denoms / dmp_clear_denoms in sympy/polys/densetools.py (wrap the mul result',
      '   in dup_strip / dmp_strip).',
      'B. Strip in DMP.clear_denoms in sympy/polys/polyclasses.py.',
      'C. Make DMP.__init__ (or DMP.per) always strip -- quantify the performance cost and how many tests change.',
      'D. Strip inside dup_mul_ground / dmp_mul_ground in densearith.py -- quantify perf cost on the hot path.',
      'E. Fix at the EX domain level so EX recognizes zero eagerly -- evaluate feasibility.',
      '',
      'For the leading candidate also settle:',
      '- strip ALWAYS vs only inside the branch that multiplied (the input itself could already be unstripped)',
      '- whether the convert=True path needs the same treatment (converting an unstripped list)',
      '- sibling functions in densetools.py with the identical unstripped-list-comprehension pattern that are',
      '  reachable from a public API with an EX domain (dup_monic/dmp_ground_monic, dup_content,',
      '  dup_primitive, dmp_ground_primitive, dup_integrate, dmp_diff, dup_shift, dup_transform, ...).',
      '  For each, say whether you could actually demonstrate reachable breakage.',
      '',
      'Empirically test candidate A: make the edit, run the repro, then run',
      PY + ' -m pytest sympy/polys/tests/test_densetools.py sympy/polys/tests/test_polytools.py -q',
      'then REVERT with: cd /testbed && git checkout -- sympy/',
      'Report exact commands, real outputs, and confirm git status is clean at the end.',
      '',
      'Return ranked candidates with diffs, evidence, and a single recommendation.',
    ].join('\n'),
  },
]

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    report: { type: 'string', description: 'Full technical report with file:line refs and verified evidence' },
    key_claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['claim', 'evidence'],
      },
    },
  },
  required: ['report', 'key_claims'],
}

const probeResults = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: 'probe:' + p.key, phase: 'Investigate', schema: FINDING_SCHEMA })
    .then(r => ({ key: p.key, report: r.report, key_claims: r.key_claims }))
))

const good = probeResults.filter(Boolean)
log(good.length + '/' + PROBES.length + ' probes returned')

phase('Verify')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the claim is wrong, unsupported, or misleading' },
    reasoning: { type: 'string' },
    correction: { type: 'string', description: 'what is actually true, if refuted' },
  },
  required: ['refuted', 'reasoning'],
}

const allClaims = good.flatMap(r => (r.key_claims || []).map(c => ({ claim: c.claim, evidence: c.evidence, probe: r.key })))
log('verifying ' + allClaims.length + ' claims')

const verified = await parallel(allClaims.slice(0, 40).map((c, i) => () =>
  agent([CONTEXT, '',
    'Adversarially verify this claim about the /testbed sympy repo. Try to REFUTE it. Actually run code',
    'with ' + PY + ' and read the referenced source. Default to refuted=true if you cannot substantiate it.',
    '',
    'CLAIM (from probe "' + c.probe + '"): ' + c.claim,
    'CLAIMED EVIDENCE: ' + c.evidence,
    '',
    'Do not edit repo files. If you must experiment with an edit, revert it and confirm git status is clean.',
  ].join('\n'),
    { label: 'verify:' + c.probe + ':' + i, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then(v => ({ claim: c.claim, probe: c.probe, verdict: v }))
))

const vs = verified.filter(Boolean)
const confirmed = vs.filter(v => !v.verdict.refuted)
const refuted = vs.filter(v => v.verdict.refuted)
log(confirmed.length + ' confirmed, ' + refuted.length + ' refuted')

phase('Synthesize')

const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    recommendation: { type: 'string', description: 'The single recommended fix, as exact before/after snippets with file:line' },
    rationale: { type: 'string' },
    rejected: { type: 'string', description: 'Other candidates and why rejected' },
    sibling_fixes: { type: 'string', description: 'Other functions needing the same treatment, with justification for including or excluding' },
    tests_to_add: { type: 'string', description: 'Exact copy-pasteable test code with target file paths' },
    risks: { type: 'array', items: { type: 'string' } },
    verification_plan: { type: 'string', description: 'Exact commands to verify' },
  },
  required: ['recommendation', 'rationale', 'rejected', 'sibling_fixes', 'tests_to_add', 'risks', 'verification_plan'],
}

const dossier = good.map(r => '### PROBE: ' + r.key + '\n' + r.report).join('\n\n')
const refutations = refuted.map(r => '- [REFUTED, probe ' + r.probe + '] ' + r.claim + '\n  -> ' + (r.verdict.correction || r.verdict.reasoning)).join('\n')

const synth = await agent([CONTEXT, '',
  'Four parallel probes investigated this bug. Their reports:',
  '',
  dossier,
  '',
  'An adversarial verification pass REFUTED these claims -- treat them as unreliable, do not build on them:',
  refutations || '(none refuted)',
  '',
  'Your job: produce the final implementation plan. Decide ONE fix. Be minimal and surgical: this is a',
  'bug fix for an upstream open-source project, so prefer the smallest change that fixes the root cause',
  'at the right layer, in the existing code style, with no scope creep.',
  '',
  'Requirements:',
  '- Exact before/after code with file:line.',
  '- Explicitly settle: strip always vs only when common != 1; and whether convert=True needs it.',
  '- Explicitly settle whether to also fix the multivariate dmp_clear_denoms.',
  '- Sibling functions: recommend including ONLY those with demonstrated reachable breakage.',
  '- Copy-pasteable tests in the repo existing style with exact target files.',
  '- The verification command list.',
  '',
  'Verify anything uncertain by reading /testbed source or running ' + PY + '. Leave no edits behind;',
  'git status must be clean when you finish.',
].join('\n'),
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA, effort: 'high' })

return { synth: synth, confirmed_count: confirmed.length, refuted: refuted.map(r => ({ probe: r.probe, claim: r.claim, correction: r.verdict.correction })) }
