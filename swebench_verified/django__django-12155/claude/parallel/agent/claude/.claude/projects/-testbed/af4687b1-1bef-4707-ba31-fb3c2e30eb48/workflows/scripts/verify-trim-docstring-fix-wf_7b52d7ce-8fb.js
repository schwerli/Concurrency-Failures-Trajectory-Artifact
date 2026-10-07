export const meta = {
  name: 'verify-trim-docstring-fix',
  description: 'Audit and adversarially verify the admindocs trim_docstring first-line indentation fix',
  phases: [
    { title: 'Audit', detail: 'call sites, edge cases, same-bug-elsewhere, repro' },
    { title: 'Verify', detail: 'adversarially refute each finding' },
    { title: 'Synthesize', detail: 'merge into a single report' },
  ],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'important', 'minor', 'info'] },
          evidence: { type: 'string', description: 'command run + observed output, or exact code quoted' },
        },
        required: ['title', 'detail', 'severity', 'evidence'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['refuted', 'reasoning'],
}

const CONTEXT = `
Repo: /testbed (Django, git branch main). Python interpreter to use for ANY execution:
  /opt/miniconda3/envs/testbed/bin/python
Run Django tests like:
  cd /testbed/tests && /opt/miniconda3/envs/testbed/bin/python runtests.py admin_docs --parallel=1

The change under review (already applied to the working tree) is in
/testbed/django/contrib/admindocs/utils.py, function trim_docstring():
  BEFORE: indent = min(len(line) - len(line.lstrip()) for line in lines if line.lstrip())
  AFTER:  indent = min((len(line) - len(line.lstrip()) for line in lines[1:] if line.lstrip()), default=0)
plus a two-line explanatory comment.

Motivation (Django ticket): docstrings whose FIRST line is non-empty, e.g.
    def test():
        """test tests something.
        """
caused indent to be computed as 0 (the first line has no leading whitespace),
so subsequent lines kept their indentation and docutils raised:
    Error in "default-role" directive: no content permitted.
Skipping the first line fixes it. default=0 was added because a one-line
docstring makes lines[1:] empty and min() would raise ValueError.

Verify with 'git diff' in /testbed. Do NOT modify any files — you are auditing only.
Return raw structured data, not prose for a human.
`

const DIMENSIONS = [
  {
    key: 'repro',
    prompt: `${CONTEXT}
TASK: Empirically prove the bug existed and that the fix resolves it, end-to-end through docutils
(not just trim_docstring in isolation).
1. Write a throwaway script in /tmp (never inside /testbed) that calls
   django.contrib.admindocs.utils.parse_docstring + parse_rst on a docstring whose first line is
   NON-empty and whose body contains indented reST (mimic the ticket). Show it renders cleanly now.
2. Prove the old behavior failed: reconstruct the old one-line expression inline in your /tmp script
   (copy trim_docstring's body with the pre-fix indent line) and show it produces output that makes
   docutils emit 'Error in "default-role" directive: no content permitted.' or otherwise mis-indents.
   parse_rst may need django.conf.settings.configure(...) — configure a minimal settings with
   INSTALLED_APPS including 'django.contrib.admindocs' and ROOT_URLCONF pointing at something, or
   reuse tests/admin_docs. If parse_rst needs a URLconf, use tests/admin_docs/urls.py by running from
   /testbed/tests with DJANGO_SETTINGS_MODULE-free settings.configure.
3. Report exact commands and exact output as evidence.
Report each confirmed behavior as a finding with severity 'info' if the fix works, or 'blocker' if it does not.`,
  },
  {
    key: 'edge-cases',
    prompt: `${CONTEXT}
TASK: Hunt for INPUTS where the new trim_docstring behaves worse than the old one, or is outright wrong.
Enumerate and actually EXECUTE (via a /tmp script importing from /testbed) at least these classes:
 - one-line docstring, no trailing newline
 - one-line docstring with trailing whitespace/newline only
 - empty string, None, whitespace-only
 - docstring where first line IS empty (the classic Django style) — must be unchanged from before
 - docstring where the first line is non-empty AND later lines are LESS indented than the first
   content line, or use tabs
 - docstring where a later line has zero indentation (e.g. a line starting at col 0 in the middle)
 - docstring with \\r\\n line endings
 - docstring where lines[1:] contains only blank lines
Compare OLD vs NEW output for every case by implementing both variants in your script. Flag any case
where NEW output is semantically worse (severity important/blocker). Confirm no case raises an exception.`,
  },
  {
    key: 'callsites',
    prompt: `${CONTEXT}
TASK: Map every consumer of trim_docstring / parse_docstring / parse_rst across the whole repo
(django/ AND tests/ AND docs/), and judge whether the new indentation semantics could break any of
them. Pay attention to django/contrib/admindocs/views.py (model, view, template tag/filter, and
field-help_text paths) and to any callers that pass strings that are NOT __doc__ values (e.g. model
verbose docstrings assembled from fragments, or help_text). Report anything where skipping the first
line changes rendered output in a way a user would call a regression.`,
  },
  {
    key: 'same-pattern',
    prompt: `${CONTEXT}
TASK: Search the ENTIRE repo for other implementations of docstring-dedent / common-indentation
logic that have the same first-line bug or a bare min()/max() over a possibly-empty generator
related to docstrings (grep for 'lstrip()', 'expandtabs', 'dedent', 'getdoc', 'cleandoc', '__doc__').
Consider django/core/management/base.py, django/template/, django/utils/, and admindocs. Report any
second site that needs the same fix, and any site that is already correct (as 'info', so we know it
was checked). Do not propose changes outside admindocs unless the same user-visible bug is provable.`,
  },
  {
    key: 'tests',
    prompt: `${CONTEXT}
TASK: Determine the test situation.
1. Is docutils importable by /opt/miniconda3/envs/testbed/bin/python? Report version.
2. Run the full admin_docs test suite and report the exact result line.
3. Read /testbed/tests/admin_docs/test_utils.py and test_views.py. Report precisely WHERE a new test
   for a non-empty-first-line docstring should go, matching existing conventions (class, naming
   style, use of AdminDocsSimpleTestCase, whether docutils skipUnless is needed).
4. Propose the exact test code you would add (as a string in 'detail'), including a test that a
   one-line docstring does not crash. Do NOT write to any file.
5. Also check whether any OTHER test suite exercises trim_docstring indirectly and should be run
   (e.g. admin_views, or the docs' own checks). Name the runtests.py labels.`,
  },
]

phase('Audit')
const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `audit:${d.key}`, phase: 'Audit', schema: FINDING_SCHEMA }),
  (res, d) => {
    if (!res) return []
    const worth = res.findings.filter(f => f.severity === 'blocker' || f.severity === 'important')
    return parallel(worth.map(f => () =>
      agent(`${CONTEXT}
TASK: Adversarially REFUTE this claim about the applied fix. Re-run/inspect independently; do not
trust the claim's own evidence. Default to refuted=true if you cannot reproduce the problem exactly.

CLAIM (${f.severity}): ${f.title}
DETAIL: ${f.detail}
FILE: ${f.file || 'n/a'}:${f.line || ''}
CLAIMED EVIDENCE: ${f.evidence}`,
        { label: `refute:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ dimension: d.key, finding: f, verdict: v }))
    )).then(vs => {
      const info = res.findings
        .filter(f => f.severity !== 'blocker' && f.severity !== 'important')
        .map(f => ({ dimension: d.key, finding: f, verdict: { refuted: false, reasoning: 'informational, not verified' } }))
      return [...vs.filter(Boolean), ...info]
    })
  }
)

const all = results.flat().filter(Boolean)
const surviving = all.filter(r => !r.verdict.refuted)
log(`${all.length} findings, ${surviving.length} survived refutation`)

phase('Synthesize')
const report = await agent(`${CONTEXT}
TASK: You are the final reviewer. Below are audit findings that survived an adversarial refutation
pass, as JSON. Produce the definitive verdict on the applied fix.

Answer, concretely:
 A) Is the fix correct and complete? Any remaining defect that MUST be fixed (quote file:line and the
    exact replacement code)?
 B) The exact test code to add, and the exact file + insertion point.
 C) Any second code site needing the same fix.
 D) The runtests.py labels to run.
Independently sanity-check the top claims yourself before endorsing them. Be terse and specific.

FINDINGS JSON:
${JSON.stringify(surviving.map(s => ({ dim: s.dimension, ...s.finding, verdict: s.verdict })), null, 2)}`,
  { label: 'synthesize', phase: 'Synthesize' })

return { report, surviving: surviving.length, total: all.length }
