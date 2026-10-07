export const meta = {
  name: 'xoptions-autoreload',
  description: 'Investigate and design fix for autoreloader not passing -X options to child process',
  phases: [
    { title: 'Investigate', detail: 'sys._xoptions semantics, call sites, existing tests' },
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
          evidence: { type: 'string', description: 'file:line or command output' },
        },
        required: ['claim', 'evidence'],
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
    correction: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const LENSES = [
  {
    key: 'xoptions-semantics',
    prompt: `In the Django repo at /testbed, determine the EXACT semantics of Python's sys._xoptions dict.
Run real python commands to check, e.g.:
  python3 -X utf8 -c "import sys; print(sys._xoptions)"
  python3 -X utf8=1 -X dev -c "import sys; print(sys._xoptions)"
  python3 -X pycache_prefix=/tmp/x -c "import sys; print(sys._xoptions)"
  python3 -c "import sys; print(sys._xoptions)"
Report: what are the key/value types? When is a value the boolean True vs a string? What is the correct way to reconstruct the original command-line "-X..." arguments from the dict? Does "-Xutf8" (no space) work as an argv element? Verify by actually running: python3 -Xutf8 -c "import sys; print(sys.flags.utf8_mode)".
Also check what python version this repo targets (setup.cfg / setup.py python_requires) and whether sys._xoptions exists on all supported versions and on PyPy.
Return concrete evidence (actual command output) for each claim.`,
  },
  {
    key: 'call-sites',
    prompt: `In the Django repo at /testbed, read django/utils/autoreload.py fully, especially get_child_arguments() (~line 213) and restart_with_reloader().
Report:
- Exactly how args are built today (warnoptions handling at line ~222).
- Every branch of get_child_arguments (the -m/__spec__ branch, the Windows .exe entrypoint branch, the -script.py branch, the else branch) and whether the "args" list built at the top is used in each branch. Critically: does the exe_entrypoint branch return WITHOUT args? That matters for where a new -X insertion must go.
- Every caller of get_child_arguments() across the whole repo (grep).
Return exact file:line evidence.`,
  },
  {
    key: 'tests',
    prompt: `In the Django repo at /testbed, find ALL existing tests for get_child_arguments and restart_with_reloader. Look in tests/utils_tests/test_autoreload.py.
Report:
- The test class name(s), how they patch sys.argv / sys.executable / sys.warnoptions (exact mock.patch targets and decorators used).
- Show the full source of the warnoptions-related tests verbatim (e.g. test_warnoptions), and the surrounding class setup, so a new -X test can be written in the identical style.
- How tests for restart_with_reloader are written (they may patch sys.warnoptions and check the child env/args).
- Whether there is a test that runs a real subprocess.
Return exact file:line + verbatim code.`,
  },
  {
    key: 'upstream',
    prompt: `In the Django repo at /testbed, this is Django ticket #33076 "Auto-reloader should pass -X options (for cpython implementation)".
Check git log / git history for any related prior work on get_child_arguments (e.g. commits adding warnoptions support: git log --oneline -- django/utils/autoreload.py | head -40, and git log -S "warnoptions" --oneline).
Report what the analogous warnoptions commit changed (source + tests + any docs/release notes) so the -X fix can mirror it exactly. Check whether docs/releases/ has a 4.0.txt in-development release notes file and whether such small fixes get an entry there (look at how other entries are written).
Return exact evidence.`,
  },
]

phase('Investigate')
const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `investigate:${l.key}`, phase: 'Investigate', schema: FINDINGS }),
  (r, l) => {
    if (!r) return null
    return parallel(r.claims.map(c => () =>
      agent(`You are an adversarial verifier working in the Django repo at /testbed.
Try to REFUTE this claim. Run commands / read files yourself to check. Default to refuted=true if you cannot independently confirm it.

CLAIM: ${c.claim}
CLAIMED EVIDENCE: ${c.evidence}

If refuted, give the correction.`, { label: `verify:${l.key}`, phase: 'Verify', schema: VERDICT })
        .then(v => ({ lens: l.key, claim: c.claim, evidence: c.evidence, verdict: v }))
    )).then(vs => ({ lens: l.key, summary: r.summary, checked: vs.filter(Boolean) }))
  }
)

const good = results.filter(Boolean)
return {
  lenses: good.map(g => ({
    lens: g.lens,
    summary: g.summary,
    confirmed: g.checked.filter(c => !c.verdict.refuted).map(c => ({ claim: c.claim, evidence: c.evidence })),
    refuted: g.checked.filter(c => c.verdict.refuted).map(c => ({ claim: c.claim, reason: c.verdict.reason, correction: c.verdict.correction })),
  })),
}
