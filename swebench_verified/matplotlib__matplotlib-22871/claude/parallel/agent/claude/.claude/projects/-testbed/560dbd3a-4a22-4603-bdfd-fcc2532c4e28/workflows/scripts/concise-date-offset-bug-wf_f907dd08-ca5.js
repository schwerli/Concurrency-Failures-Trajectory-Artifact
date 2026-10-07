export const meta = {
  name: 'concise-date-offset-bug',
  description: 'Root-cause and design the fix for ConciseDateFormatter hiding the year for sub-year spans',
  phases: [
    { title: 'Investigate', detail: 'blame archaeology, level semantics, test inventory, adjacent-code audit' },
    { title: 'Design', detail: 'three independent candidate fixes, each verified in its own sandbox' },
    { title: 'Judge', detail: 'score candidates for correctness, regression safety, maintainer style' },
    { title: 'Synthesize', detail: 'pick the fix, list exact edits and tests' },
  ],
}

const PY = '/opt/miniconda3/envs/testbed/bin/python'

// Every agent that needs to RUN patched code must do it in its own sandbox copy of lib/,
// never by editing /testbed/lib/matplotlib/dates.py — the env's easy-install.pth puts
// /testbed/lib on sys.path, so concurrent agents editing it would clobber each other.
const SANDBOX = (tag) => `
SANDBOX RULE — MANDATORY, no exceptions:
Other agents are working in this repo AT THE SAME TIME. You must NEVER modify any file under
/testbed. Not even temporarily. Not even if you intend to revert. Reading is fine.

To test a patch, make your own sandbox first (this is cheap, ~67MB):
    mkdir -p /tmp/sbx-${tag} && cp -a /testbed/lib /testbed/pytest.ini /testbed/setup.cfg /tmp/sbx-${tag}/
Then edit /tmp/sbx-${tag}/lib/matplotlib/dates.py (and .../tests/test_dates.py).
You MUST set PYTHONPATH on EVERY python invocation, otherwise the editable install silently
wins and you will be testing /testbed's UNPATCHED code while believing you patched it:
    cd /tmp/sbx-${tag} && PYTHONPATH=/tmp/sbx-${tag}/lib MPLBACKEND=Agg ${PY} -m pytest lib/matplotlib/tests/test_dates.py -q
    cd /tmp/sbx-${tag} && PYTHONPATH=/tmp/sbx-${tag}/lib MPLBACKEND=Agg ${PY} my_probe.py
(cwd alone is NOT enough — for \`python script.py\`, sys.path[0] is the script's directory,
not <cwd>/lib, so /testbed/lib from easy-install.pth wins.)
FIRST verify your sandbox is really the one being imported, and quote the output in your report:
    cd /tmp/sbx-${tag} && PYTHONPATH=/tmp/sbx-${tag}/lib ${PY} -c "import matplotlib.dates as d; print(d.__file__)"
It MUST print /tmp/sbx-${tag}/lib/matplotlib/dates.py. If it prints /testbed/..., your
PYTHONPATH is wrong — fix it before drawing any empirical conclusion.
Also sanity-check that your patch is actually live (e.g. assert the new behaviour appears at
all): a patch that changes nothing observable usually means the wrong module got imported.
At the end, confirm \`git -C /testbed status --porcelain\` is EMPTY.
`

const CTX = `
Repo: /testbed (matplotlib, dev version 3.6.0.dev). Interpreter: ${PY}
(plain \`python\` has NO matplotlib). Always set MPLBACKEND=Agg.

THE BUG (already reproduced by the main agent — do not doubt it, reproduce it if useful):
  mdates.AutoDateLocator + mdates.ConciseDateFormatter, plotting 199 days from 2021-02-15:
  tick labels are ['Mar','Apr','May','Jun','Jul','Aug','Sep'] and formatter.get_offset() == ''.
  The year 2021 appears NOWHERE on the axis. Expected: offset should read '2021'.
  (Distinct from issue #21670, which was fixed by PR #21785.)

Suspect code — lib/matplotlib/dates.py, ConciseDateFormatter.format_ticks, ~lines 795-806:

    # determine the level we will label at:
    # mostly 0: years,  1: months,  2: days,
    # 3: hours, 4: minutes, 5: seconds, 6: microseconds
    for level in range(5, -1, -1):
        if len(np.unique(tickdate[:, level])) > 1:
            if level < 2:
                show_offset = False
            break
        elif level == 0:
            # all tickdate are the same, so only micros might be different
            # set to the most precise (6: microseconds doesn't exist...)
            level = 5

tickdate[:, level] columns are (year, month, day, hour, minute, second) from timetuple()[:6].
Defaults:
  formats        = ['%Y', '%b', '%d', '%H:%M', '%H:%M', '%S.%f']
  zero_formats   = ['', '%Y', '%b', '%b-%d', '%H:%M', '%H:%M']
  offset_formats = ['', '%Y', '%Y-%b', '%Y-%b-%d', '%Y-%b-%d', '%Y-%b-%d %H:%M']
The offset is taken from tickdatetime[-1] (the LAST tick).
`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'details', 'evidence'],
  properties: {
    summary: { type: 'string', description: 'one-paragraph bottom line' },
    details: { type: 'array', items: { type: 'string' }, description: 'concrete factual points, each self-contained' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'file:line refs, commit hashes, or exact command output snippets backing the points' },
  },
}

phase('Investigate')

const investigations = [
  {
    label: 'blame-archaeology',
    prompt: `${CTX}

TASK: Archaeology (READ-ONLY — you do not need to run any patched code, so do not create a
sandbox; just never write to /testbed).

Find out exactly when and why the \`if level < 2: show_offset = False\` branch was introduced,
and what behaviour it was protecting.

Use: \`git log -L 770,860:lib/matplotlib/dates.py\` (adjust the range to the current file),
\`git log --oneline -S "show_offset = False" -- lib/matplotlib/dates.py\`, \`git show <sha>\`,
\`git log --oneline -S "offset_formats" -- lib/matplotlib/dates.py\`.
Also find the earlier related fix: issue #21670 fixed by PR #21785 — locate that commit
(\`git log --all --oneline --grep 21785\`, \`--grep 21670\`, \`--grep ConciseDate -i\`) and read it
in full, including the tests it added.

REPORT per relevant commit: sha, subject, what it changed in the level loop, which scenario it
fixed, which existing tests encode that scenario. Be precise about whether the \`level < 2\`
guard was aimed at level 0 (years), level 1 (months), or both, and quote the reasoning from the
commit message / diff if present.`,
  },
  {
    label: 'level-semantics-spec',
    prompt: `${CTX}
${SANDBOX('spec')}

TASK: Derive the correct SPECIFICATION for when the offset must be shown — from first
principles plus empirical probing. The documented contract is: "Combined with the tick labels
this should completely specify the date."

Write a probe script that, for a grid of (start date, span) pairs, prints: the internal level
chosen, the tick labels, and the offset. Get the level honestly — either re-run the level
detection loop on the same tick values, or patch a debug print into your SANDBOX copy of
dates.py. State which method you used.

Cover at minimum:
 - spans of 1..11 months starting in Jan, in Feb, in Jun, in Oct, in Dec
   (January-included vs not; year-boundary-crossed vs not)
 - a span crossing a year boundary with NO January tick if such a case exists
   (e.g. 2021-06-15 + 200d, + 250d) — check what the locator actually picks
 - multi-year spans (2y, 20y, 200y)
 - sub-month spans (1 day, 1 week, 3 weeks) starting mid-month and on the 1st
 - sub-day spans (1 hour, 1 minute, 0.01 s)

Then answer for EACH level 0..5: with the default formats/zero_formats, is the year (and the
month) already recoverable from the tick labels alone, and under exactly what condition on the
tick values? Confirm or refute this specific hypothesis: at level 1 (month ticks) the year is
present in the labels only when a month==1 (January) tick exists, because zero_formats[1]='%Y';
and check the analogous situation at level 0 and level 2.

REPORT: the spec as a per-level rule, plus an empirical table of (a) cases where the current
code violates it — offset empty although the year/month is unrecoverable, and (b) cases where
an offset would be redundant because the labels already carry it.`,
  },
  {
    label: 'test-and-doc-inventory',
    prompt: `${CTX}
${SANDBOX('inv')}

TASK: Inventory everything in the repo whose expected output could change if the offset starts
being shown for sub-year spans that contain no January tick.

Search lib/matplotlib/tests/test_dates.py for every assertion touching ConciseDateFormatter:
get_offset, offset_string, show_offset, offset_formats, format_ticks, and the
_create_auto_date_locator-style helpers. For each, give file:line, the input span, and the exact
expected value, and say whether the fix would change it. Evaluate EVERY parameter case of
test_concise_formatter_show_offset individually (especially timedelta(weeks=26) -> '' and
timedelta(weeks=520) -> ''), plus test_offset_changes, test_concise_formatter,
test_concise_formatter_subsecond, test_concise_formatter_usetex, and any test asserting a full
tick-label list for a month-level span.

Also find non-test surfaces: examples/ticks/date_concise_formatter.py, .plot:: blocks in
lib/matplotlib/dates.py docstrings, tutorials, and any image-comparison baseline
(\`grep -rn -i concise lib/matplotlib/tests/ examples/ tutorials/ doc/\`). For each say whether
it is an image comparison (baseline PNG would need regenerating) or a text assertion.

Establish the BASELINE on the unpatched code (read-only, no sandbox edit needed):
  cd /testbed && MPLBACKEND=Agg ${PY} -m pytest lib/matplotlib/tests/test_dates.py -q 2>&1 | tail -20
Report the exact pass/fail/skip counts.`,
  },
  {
    label: 'adjacent-code-audit',
    prompt: `${CTX}
${SANDBOX('audit')}

TASK: Audit the surrounding code for OTHER defects in this area, kept clearly separate from the
main reported bug.

Read ConciseDateFormatter.format_ticks in full and investigate:
 1. The \`elif level == 0: level = 5\` branch (all six fields identical across ticks). Is the
    resulting offset correct? Probe a single-point / zero-span axis (ax.set_xlim(d, d)).
 2. Interaction with user-supplied formats/zero_formats/offset_formats: if a user passes
    zero_formats whose [1] entry lacks the year, does the "January tick carries the year"
    reasoning break? What does that imply about how conservative the fix should be? (We will
    NOT parse format strings — the question is the least-surprising DEFAULT behaviour.)
 3. show_offset=False passed by the user: prove the fix cannot turn the offset back ON. Trace
    the local \`show_offset\` variable versus self.show_offset.
 4. The usetex path (_wrap_in_tex on the offset): any problem with a bare '2021'?
 5. The offset is built from tickdatetime[-1] (LAST tick). For a span crossing a year boundary
    with month-level ticks, is last-tick right, or should it be the first? Probe empirically
    (e.g. 2021-06-15 + 250 days) and say what the offset would claim vs what is true.

REPORT each item with a verdict: real defect / by design / worth a comment — plus evidence.`,
  },
]

const findings = await parallel(investigations.map(inv => () =>
  agent(inv.prompt, { label: inv.label, phase: 'Investigate', schema: FINDING_SCHEMA })))

const brief = investigations.map((inv, i) => {
  const f = findings[i]
  if (!f) return `### ${inv.label}\n(investigation failed, no data)`
  return `### ${inv.label}\n${f.summary}\n\nPOINTS:\n${f.details.map(d => `- ${d}`).join('\n')}\n\nEVIDENCE:\n${f.evidence.map(e => `- ${e}`).join('\n')}`
}).join('\n\n')

log('Investigation complete; generating candidate fixes')

phase('Design')

const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'rationale', 'diff', 'behaviour_changes', 'risks', 'tests', 'verification'],
  properties: {
    name: { type: 'string' },
    rationale: { type: 'string' },
    diff: { type: 'string', description: 'exact old code block and exact new code block, copy-pasteable, plus the file:line it goes at' },
    behaviour_changes: { type: 'array', items: { type: 'string' }, description: 'each: input span -> old offset -> new offset' },
    risks: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' }, description: 'exact pytest code to add, and existing tests needing updates' },
    verification: { type: 'string', description: 'sandbox path used, the dates.__file__ it printed, the reproduction offset observed, and the exact pytest counts' },
  },
}

const angles = [
  { label: 'design:minimal-guard', tag: 'min', angle: `Take the MINIMAL-DIFF angle. Change as little as possible in the level-detection loop — ideally refine the existing \`if level < 2\` condition itself so it suppresses the offset only when the tick labels genuinely already carry the year. Aim for a one-line change plus a short explanatory comment, the kind a matplotlib reviewer merges without discussion.` },
  { label: 'design:invariant-first', tag: 'inv', angle: `Take the INVARIANT-FIRST angle. Design from the documented contract "tick labels + offset completely specify the date". Consider deciding from whether any tick actually renders with a zero_format that carries the year, rather than hard-coding a month==1 test. Weigh generality against complexity and against how much format-string parsing it would require. Say plainly if the general version is over-engineered — a negative recommendation is a valid result here.` },
  { label: 'design:upstream-fidelity', tag: 'ups', angle: `Take the UPSTREAM-FIDELITY angle. This is a real matplotlib issue and a fix was accepted upstream. Reason about what the maintainers most plausibly merged, in their house style (tiny commented condition change + an extension of the existing parametrized test). Do NOT rely on network access; infer from the codebase's own conventions and neighbouring commits. Your diff should look like it came from the matplotlib repo.` },
]

const candidates = await parallel(angles.map(a => () =>
  agent(`${CTX}
${SANDBOX(a.tag)}

Findings from four parallel investigations of this bug:

${brief}

TASK: Propose ONE concrete fix. ${a.angle}

Hard requirements:
 - It must make the reported case (2021-02-15 + 199 days) show offset '2021'.
 - It must NOT break test_concise_formatter_show_offset — in particular the
   (timedelta(weeks=26), '') and (timedelta(weeks=520), '') cases — nor test_offset_changes.
   If you believe an existing expectation is itself wrong, argue it explicitly rather than
   silently changing it.
 - It must respect a user-passed show_offset=False.
 - VERIFY EMPIRICALLY IN YOUR SANDBOX before reporting: apply the patch there, run the
   reproduction, and run the full test_dates.py. Report the ACTUAL pass/fail counts you
   observed, never what you expect. Fill in the \`verification\` field with the sandbox path,
   the printed matplotlib.dates.__file__, the observed offset, and the pytest tail.`,
    { label: a.label, phase: 'Design', schema: CANDIDATE_SCHEMA })))

const alive = candidates.filter(Boolean)
log(`${alive.length} candidate fixes generated; judging`)

phase('Judge')

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'total', 'best_candidate_name', 'reasoning', 'objections'],
  properties: {
    scores: {
      type: 'object',
      additionalProperties: false,
      required: ['correctness', 'minimality', 'style_fit', 'regression_safety'],
      properties: {
        correctness: { type: 'integer', minimum: 0, maximum: 10 },
        minimality: { type: 'integer', minimum: 0, maximum: 10 },
        style_fit: { type: 'integer', minimum: 0, maximum: 10 },
        regression_safety: { type: 'integer', minimum: 0, maximum: 10 },
      },
    },
    total: { type: 'integer' },
    best_candidate_name: { type: 'string' },
    reasoning: { type: 'string' },
    objections: { type: 'array', items: { type: 'string' }, description: 'concrete failure scenarios for the candidate you judged best' },
  },
}

const packet = alive.map((c, i) => `## CANDIDATE ${i + 1}: ${c.name}
RATIONALE: ${c.rationale}
DIFF:
${c.diff}
BEHAVIOUR CHANGES:
${c.behaviour_changes.map(b => `- ${b}`).join('\n')}
RISKS:
${c.risks.map(r => `- ${r}`).join('\n')}
TESTS:
${c.tests.map(t => `- ${t}`).join('\n')}
VERIFICATION AS REPORTED: ${c.verification}`).join('\n\n')

const lenses = [
  { label: 'judge:correctness', tag: 'jc', sandbox: true, lens: 'CORRECTNESS. Does each candidate actually restore the "labels + offset fully specify the date" invariant across the whole case grid? Hunt for spans where a candidate still hides the year, or now shows a redundant or outright wrong offset (remember the offset comes from the LAST tick). Apply the candidates in your own sandbox and probe — do not reason in the abstract.' },
  { label: 'judge:regression', tag: 'jr', sandbox: true, lens: 'REGRESSION SAFETY. Apply each candidate in your own sandbox and run the full test_dates.py, plus anything else plausibly affected (e.g. `-k date` selections in lib/matplotlib/tests/test_axes.py, test_ticker.py, test_units.py). Report real numbers. Judge whether any user-visible behaviour changes beyond the bug being fixed, and whether that warrants a note under doc/users/next_whats_new or doc/api/next_api_changes.' },
  { label: 'judge:style', tag: 'js', sandbox: false, lens: 'MAINTAINER STYLE. Which candidate reads most like the surrounding matplotlib code — comment density, naming, no needless abstraction, and a test written as an extension of the existing parametrized test rather than a bespoke new one? Penalise over-engineering and any candidate that parses format strings. Reading files is enough; you need not run anything.' },
]

const judgments = await parallel(lenses.map(l => () =>
  agent(`${CTX}
${l.sandbox ? SANDBOX(l.tag) : 'READ-ONLY: do not modify anything under /testbed. Other agents are working there concurrently.'}

${packet}

TASK: Judge ALL of the above candidates through exactly one lens: ${l.lens}

Score the candidate you consider best on the 0-10 scales, name it exactly as given above, and
list concrete objections to it (there is always at least one). If you think a BETTER fix exists
that none of the candidates proposed, say so explicitly and give its diff inside your reasoning.`,
    { label: l.label, phase: 'Judge', schema: VERDICT_SCHEMA })))

phase('Synthesize')

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chosen_fix_diff', 'why', 'exact_old_string', 'exact_new_string', 'tests_to_add', 'tests_to_update', 'verification_commands', 'residual_risks', 'needs_whats_new'],
  properties: {
    chosen_fix_diff: { type: 'string' },
    why: { type: 'string' },
    exact_old_string: { type: 'string', description: 'verbatim current text from lib/matplotlib/dates.py to be replaced, exact whitespace, unique in the file' },
    exact_new_string: { type: 'string', description: 'verbatim replacement text, exact whitespace' },
    tests_to_add: { type: 'array', items: { type: 'string' }, description: 'copy-pasteable pytest code with target file and insertion point' },
    tests_to_update: { type: 'array', items: { type: 'string' }, description: 'file:line, old expectation, new expectation, and why the change is correct rather than a papered-over regression' },
    verification_commands: { type: 'array', items: { type: 'string' }, description: 'commands run and the actual observed output/counts' },
    residual_risks: { type: 'array', items: { type: 'string' } },
    needs_whats_new: { type: 'string', description: 'yes/no plus one line of justification' },
  },
}

const plan = await agent(`${CTX}
${SANDBOX('final')}

INVESTIGATIONS:
${brief}

CANDIDATES:
${packet}

JUDGMENTS:
${judgments.filter(Boolean).map((j, i) => `## ${lenses[i]?.label ?? 'judge'}
best: ${j.best_candidate_name} (total ${j.total}; correctness ${j.scores.correctness}, minimality ${j.scores.minimality}, style ${j.scores.style_fit}, regression ${j.scores.regression_safety})
reasoning: ${j.reasoning}
objections:
${j.objections.map(o => `- ${o}`).join('\n')}`).join('\n\n')}

TASK: Produce THE final implementation plan. Pick the winning fix, graft in any superior idea
from a runner-up or from a judge's counter-proposal, and address the judges' objections.

Validate the whole plan end to end IN YOUR SANDBOX before reporting:
 1. Apply your chosen edit to /tmp/sbx-final/lib/matplotlib/dates.py.
 2. Apply your test additions/updates to /tmp/sbx-final/lib/matplotlib/tests/test_dates.py.
 3. cd /tmp/sbx-final && MPLBACKEND=Agg ${PY} -m pytest lib/matplotlib/tests/test_dates.py -q
 4. Run the reproduction and confirm the offset is '2021'.
 5. Re-probe the case grid for regressions (sub-day, multi-year, January-included spans).

exact_old_string / exact_new_string must be byte-exact against the CURRENT /testbed file and
unique in it, so a single Edit call succeeds first try. The main agent will apply the real edit
to /testbed itself — you must leave /testbed untouched. Report the pytest numbers you actually
saw.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high', schema: PLAN_SCHEMA })

return { plan, judgments: judgments.filter(Boolean), candidates: alive }
