export const meta = {
  name: 'design-call-command-mutex-fix',
  description: 'Design the fix for call_command not passing required-mutually-exclusive-group args from kwargs',
  phases: [
    { title: 'Understand', detail: 'parallel readers over call_command semantics, argparse internals, test conventions' },
    { title: 'Design', detail: '4 independent candidate implementations' },
    { title: 'Judge', detail: 'score each candidate on correctness/edge-cases/style' },
    { title: 'Synthesize', detail: 'merge winner with best ideas from runners-up' },
  ],
}

const REPO = '/testbed'
const TARGET = '/testbed/django/core/management/__init__.py'

phase('Understand')

const UNDERSTAND_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'string' } },
    gotchas: { type: 'array', items: { type: 'string' } },
    citations: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'gotchas', 'citations'],
  additionalProperties: false,
}

const READERS = [
  {
    key: 'call_command',
    prompt: `Read ${TARGET} (function call_command, roughly lines 76-160) in full, plus django/core/management/base.py (CommandParser, BaseCommand.create_parser/execute).

Explain PRECISELY the current mechanism by which required arguments passed via **options are forwarded into parser.parse_args(), including:
- the opt_mapping / arg_options translation
- the get_actions() generator and why sub-parser actions are flattened
- why the '{}={}'.format(min(opt.option_strings), ...) form is used and what it implies for nargs='?', nargs='*', nargs='+', store_true, and append actions
- what happens to the parsed result afterwards (defaults = dict(defaults._get_kwargs(), **arg_options)) and therefore what the parse_args() call is actually FOR (hint: it is validation + defaults, the kwargs win afterwards)

Report exact line numbers. This is a factual read — do not propose a fix.`,
  },
  {
    key: 'argparse',
    prompt: `Investigate Python's argparse internals relevant to mutually exclusive groups. Use \`python -c\` experiments (python is available; repo at ${REPO}).

Determine and VERIFY EMPIRICALLY:
1. Where does an ArgumentParser record mutually exclusive groups? (_mutually_exclusive_groups; each group has .required and ._group_actions)
2. Are groups added inside an argument *group* (parser.add_argument_group(...).add_mutually_exclusive_group()) still registered on the top-level parser's _mutually_exclusive_groups? Test it.
3. Are mutually exclusive groups defined on a SUB-parser (created via add_subparsers().add_parser()) visible on the top-level parser's _mutually_exclusive_groups? Test it.
4. Can a mutually exclusive group be nested inside another mutually exclusive group? What does _mutually_exclusive_groups look like then? Test it.
5. Can an action inside a mutually exclusive group itself have required=True? (argparse raises ValueError? test it)
6. What error message does argparse/Django produce when a required mutex group gets nothing? When it gets two members?
7. What is the minimum Python version supported by this Django checkout (check setup.py / setup.cfg), and does _mutually_exclusive_groups / _group_actions exist across all of them?

Report exact experiment output. Factual only — do not propose a fix.`,
  },
  {
    key: 'tests',
    prompt: `Read ${REPO}/tests/user_commands/tests.py in full and list every management command module under ${REPO}/tests/user_commands/management/commands/ (read the short ones: required_option.py, subparser.py, subparser_dest.py, subparser_required.py, set_option.py, common_args.py).

Report:
- the exact naming/style conventions for test command modules (imports, class shape, handle() body, how they echo options to stdout)
- how existing tests assert (e.g. test_call_command_with_required_parameters_in_options at ~line 200) — exact assertion style
- where in tests.py a new test for "required mutually exclusive group passed via kwargs" would most naturally go (give the line number and the neighbouring test names)
- whether any existing test would break if call_command started forwarding mutex-group members from kwargs

Factual only — do not write the fix.`,
  },
  {
    key: 'callers',
    prompt: `Search the whole ${REPO} tree for every add_mutually_exclusive_group( call inside a management command's add_arguments (django/core/management/commands/*, django/contrib/**/management/commands/*, and tests/).

For each: is it required=True or required=False? What are the member option strings and dests? Are any of them nargs='?' / store_true / store_const?

Then search for call_command( invocations across ${REPO}/tests and ${REPO}/django that pass one of those mutex members as a KEYWORD argument (e.g. showmigrations list=/plan=, or similar). Report whether a fix that forwards mutex members from kwargs into parse_args() could change behaviour for any existing caller.

Factual only.`,
  },
]

const understanding = await parallel(READERS.map(r => () =>
  agent(r.prompt, { label: `read:${r.key}`, phase: 'Understand', schema: UNDERSTAND_SCHEMA })
    .then(v => v && ({ key: r.key, ...v }))
))

const ctx = understanding.filter(Boolean).map(u =>
  `### ${u.key}\nFINDINGS:\n${u.findings.map(f => '- ' + f).join('\n')}\nGOTCHAS:\n${u.gotchas.map(f => '- ' + f).join('\n')}\nCITATIONS:\n${u.citations.map(f => '- ' + f).join('\n')}`
).join('\n\n')

log(`Understanding gathered from ${understanding.filter(Boolean).length}/4 readers`)

phase('Design')

const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string', description: 'One-paragraph description of the strategy' },
    diff: { type: 'string', description: 'The exact replacement code for the relevant region of call_command, as literal Python source (not a patch format)' },
    rationale: { type: 'string' },
    edgeCasesHandled: { type: 'array', items: { type: 'string' } },
    edgeCasesNotHandled: { type: 'array', items: { type: 'string' } },
    testsProposed: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['approach', 'diff', 'rationale', 'edgeCasesHandled', 'edgeCasesNotHandled', 'testsProposed', 'risks'],
  additionalProperties: false,
}

const BRIEF = `# Task
Fix this Django bug (real ticket):

  call_command() fails when an argument belonging to a REQUIRED mutually exclusive group is passed as a kwarg.

  Repro command:
    shop = parser.add_mutually_exclusive_group(required=True)
    shop.add_argument('--shop-id', nargs='?', type=int, default=None, dest='shop_id')
    shop.add_argument('--shop', nargs='?', type=str, default=None, dest='shop_name')

  call_command('my_command', shop_id=1)
  -> CommandError: Error: one of the arguments --shop-id --shop is required

  call_command('my_command', '--shop-id=1')   # works

  Root cause: call_command only forwards kwargs into parse_args() for actions with
  action.required == True. Members of a required mutually exclusive group have
  action.required == False -- the *group* is required, not the individual action.

# File to change
${TARGET}  (function call_command)

# Established facts from the research phase
${ctx}

# What to produce
A concrete, minimal, idiomatic-Django implementation. Give the literal Python source for the region you change (enough surrounding context that it can be applied unambiguously). Also propose the test(s) and the new tests/user_commands/management/commands/ module if you need one.

Constraints:
- Must not regress the existing subparser handling (get_actions flattening).
- Must not forward kwargs for NON-required mutex groups (that would change behaviour for e.g. showmigrations --list/--plan).
- Must produce a sensible error if the user passes TWO members of the same required mutex group via kwargs.
- Style must match the surrounding code (Django 3.0-era, no f-strings in this file -- check).
- Think about nargs='?' / store_true / append members: does '{}={}'.format(min(opt.option_strings), value) work for all of them, and is that a pre-existing limitation you should NOT try to fix here?`

const ANGLES = [
  { key: 'minimal', angle: `Take the MINIMAL-DIFF angle. Change as few lines as possible. Prefer extending the existing list comprehension condition over adding new structure. This is what a core Django committer would merge.` },
  { key: 'explicit', angle: `Take the EXPLICIT-STRUCTURE angle. Introduce a clearly-named helper/variable set (e.g. a set of dests belonging to required mutex groups) computed alongside parser_actions, and use it in the condition. Optimize for readability and for a future reader understanding WHY.` },
  { key: 'robust', angle: `Take the ROBUSTNESS angle. Worry hardest about the edge cases: nested mutex groups, mutex groups declared inside argument groups, mutex groups on sub-parsers, two members passed at once, a member with nargs='?' and no value, a store_true member. Your solution should be defensible against every one of those.` },
  { key: 'upstream', angle: `Take the UPSTREAM-FIDELITY angle. Reason about what the actual Django project most likely committed for this ticket (Django 3.0/3.1 era, django/core/management/__init__.py). Recall/derive the real upstream patch shape as closely as you can, and justify it from the code. Do NOT fetch the network; derive it from the code and from Django's conventions.` },
]

const candidates = await parallel(ANGLES.map(a => () =>
  agent(`${BRIEF}\n\n# Your assigned angle\n${a.angle}`, { label: `design:${a.key}`, phase: 'Design', schema: CANDIDATE_SCHEMA })
    .then(v => v && ({ key: a.key, ...v }))
))

const live = candidates.filter(Boolean)
log(`${live.length}/4 candidate designs produced`)

phase('Judge')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: {
        correctness: { type: 'number' },
        edgeCaseCoverage: { type: 'number' },
        minimality: { type: 'number' },
        djangoIdiom: { type: 'number' },
      },
      required: ['correctness', 'edgeCaseCoverage', 'minimality', 'djangoIdiom'],
      additionalProperties: false,
    },
    total: { type: 'number' },
    fatalFlaws: { type: 'array', items: { type: 'string' } },
    bestIdeas: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['scores', 'total', 'fatalFlaws', 'bestIdeas', 'verdict'],
  additionalProperties: false,
}

const CANDS_TEXT = live.map((c, i) =>
  `## Candidate ${i + 1} (${c.key})\nAPPROACH: ${c.approach}\n\nCODE:\n\`\`\`python\n${c.diff}\n\`\`\`\n\nRATIONALE: ${c.rationale}\nHANDLES: ${c.edgeCasesHandled.join('; ')}\nDOES NOT HANDLE: ${c.edgeCasesNotHandled.join('; ')}\nRISKS: ${c.risks.join('; ')}`
).join('\n\n---\n\n')

const LENSES = [
  { key: 'correctness', lens: `CORRECTNESS lens. Mentally execute each candidate against: (a) call_command('cmd', shop_id=1), (b) call_command('cmd', '--shop-id=1'), (c) call_command('cmd') expecting the required-group error to still fire, (d) call_command('cmd', shop_id=1, shop_name='x') expecting a not-allowed-together error, (e) the existing required_option and subparser_required tests. Actually run python experiments in ${REPO} if that settles a question. Score honestly; flag anything that would raise or silently misbehave.` },
  { key: 'edge', lens: `EDGE-CASE lens. Attack each candidate with: mutex group nested in an argument group; mutex group on a sub-parser; nested mutex groups; a required mutex group whose member is store_true; a member with nargs='?'; a member whose dest differs from its option string (dest='shop_name' for '--shop'); a mutex group that is NOT required (must be untouched). Run python experiments to confirm argparse's actual behaviour rather than guessing.` },
  { key: 'style', lens: `DJANGO-IDIOM lens. Read the actual surrounding code at ${TARGET}. Which candidate reads like it was always there? Check: variable naming, comment style and placement, use of set vs list comprehension, whether f-strings are used elsewhere in THIS file (they must match), line length <= 119. Also judge the proposed tests against ${REPO}/tests/user_commands/tests.py conventions.` },
]

const judged = await pipeline(
  live,
  (c) => c,
  (c) => parallel(LENSES.map(l => () =>
    agent(`You are judging candidate implementations for a Django bug fix.\n\n${BRIEF}\n\n# All candidates\n${CANDS_TEXT}\n\n# Judge THIS candidate only: "${c.key}"\n\n# Your lens\n${l.lens}\n\nScore 0-10 per dimension. total = sum. Be a harsh grader.`,
      { label: `judge:${c.key}/${l.key}`, phase: 'Judge', schema: VERDICT_SCHEMA })
  )).then(vs => ({ candidate: c, votes: vs.filter(Boolean) }))
)

const ranked = judged.filter(Boolean).map(j => ({
  key: j.candidate.key,
  candidate: j.candidate,
  avg: j.votes.length ? j.votes.reduce((s, v) => s + v.total, 0) / j.votes.length : 0,
  fatalFlaws: j.votes.flatMap(v => v.fatalFlaws),
  bestIdeas: j.votes.flatMap(v => v.bestIdeas),
  verdicts: j.votes.map(v => v.verdict),
})).sort((a, b) => b.avg - a.avg)

log(`Ranking: ${ranked.map(r => `${r.key}=${r.avg.toFixed(1)}`).join(', ')}`)

phase('Synthesize')

const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    finalCode: { type: 'string', description: 'Literal Python source for the changed region of call_command, ready to apply' },
    anchorOldString: { type: 'string', description: 'The exact existing source text this replaces, copied verbatim from the file' },
    explanation: { type: 'string' },
    newTestCommandPath: { type: 'string' },
    newTestCommandSource: { type: 'string' },
    testAdditions: { type: 'string', description: 'Literal Python source of the test methods to add to tests/user_commands/tests.py' },
    testInsertAfter: { type: 'string', description: 'Name of the existing test method the additions should follow' },
    verificationCommands: { type: 'array', items: { type: 'string' } },
    knownLimitations: { type: 'array', items: { type: 'string' } },
  },
  required: ['finalCode', 'anchorOldString', 'explanation', 'newTestCommandPath', 'newTestCommandSource', 'testAdditions', 'testInsertAfter', 'verificationCommands', 'knownLimitations'],
  additionalProperties: false,
}

const synth = await agent(
  `${BRIEF}

# Candidate designs
${CANDS_TEXT}

# Judge panel results (ranked, best first)
${ranked.map(r => `## ${r.key} — avg score ${r.avg.toFixed(1)}\nFATAL FLAWS: ${r.fatalFlaws.join('; ') || 'none'}\nBEST IDEAS: ${r.bestIdeas.join('; ')}\nVERDICTS: ${r.verdicts.join(' || ')}`).join('\n\n')}

# Your job
Produce the FINAL implementation. Start from the winner (${ranked[0] ? ranked[0].key : 'n/a'}) and graft in the best ideas from the runners-up. Fix every fatal flaw the panel found.

You MUST read ${TARGET} yourself and copy the \`anchorOldString\` VERBATIM from it (exact whitespace, exact text) so an Edit tool call can apply the replacement unambiguously. Read ${REPO}/tests/user_commands/tests.py to get testInsertAfter right and to match assertion style.

Do NOT edit any files. Return the plan only. Also give the exact shell commands to verify (the repo's test runner is \`python tests/runtests.py <label>\` run from ${REPO}).`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA, effort: 'high' }
)

return { ranked: ranked.map(r => ({ key: r.key, avg: r.avg })), synth }
