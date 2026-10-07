export const meta = {
  name: 'encodedfile-mode-investigate',
  description: 'Investigate the EncodedFile.mode bug and how to fix + test it in this pytest checkout',
  phases: [
    { title: 'Investigate', detail: 'parallel readers: capture.py semantics, mode consumers, test conventions, changelog conventions' },
    { title: 'Synthesize', detail: 'merge findings into one concrete implementation + test plan' },
  ],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    details: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'details'],
  additionalProperties: false,
}

const LENSES = [
  {
    key: 'capture-semantics',
    prompt: `You are reading the pytest checkout at /testbed (pytest 4.5.0 era).

Read src/_pytest/capture.py in full. Focus on class EncodedFile (~line 425), safe_text_dupfile, and every Capture class (FDCapture, FDCaptureBinary, SysCapture, etc.).

Question: EncodedFile wraps a binary buffer opened with os.fdopen(newfd, mode + "b", 0). Because of __getattr__ delegation, EncodedFile.mode returns the UNDERLYING binary mode (e.g. "rb+"), which lies to callers that sniff .mode to decide whether to write str or bytes (GitHub issue: youtube-dl checks 'b' in out.mode).

Report precisely:
1. What modes the underlying buffer can actually have in each code path that constructs an EncodedFile (trace safe_text_dupfile callers and any direct EncodedFile(...) constructions). Give concrete mode strings.
2. Whether buffer.mode always exists in those paths, and what happens for EncodedFile(None, None) (see testing/test_capture.py test_pickling_and_unpickling_encoded_file) or other stand-ins.
3. Whether adding an explicit "mode" property that strips "b" could break any internal pytest consumer.
4. Exact line numbers you'd touch.

Return findings as data, not prose fluff.`,
  },
  {
    key: 'mode-consumers',
    prompt: `You are in the pytest checkout at /testbed.

Task: exhaustively find every place — in src/ and testing/ — that reads a file-like object's ".mode" attribute or checks for "b" in a mode string. Use grep for patterns like: \\.mode, "b" in, 'b' not in, getattr(.*mode.

For each hit report: file:line, the code, and whether an EncodedFile instance could plausibly reach it (explain the reachability path).

Also check src/_pytest/capture.py's safe_text_dupfile at ~line 414 which does '"b" not in getattr(f, "mode", "")' — analyze whether making EncodedFile.mode strip "b" changes behavior if an EncodedFile were passed back into safe_text_dupfile (does that happen? e.g. nested capture, capsys/capfd fixtures, dupfile of an already-wrapped stream).

Return findings as data.`,
  },
  {
    key: 'test-conventions',
    prompt: `You are in the pytest checkout at /testbed.

Read testing/test_capture.py, especially the section around EncodedFile tests (grep EncodedFile — around line 1455) and nearby standalone test functions.

Report:
1. The existing test style for EncodedFile-level unit tests (are they plain functions? do they use tmpfile/testdir fixtures? is there a "tmpfile" fixture defined in that file — show it).
2. How other tests build a real EncodedFile over a real binary temp file (show working snippets copied from the file).
3. Whether py2/py3 compat matters here (does the file use six, _PY3, sys.version_info guards? show examples) — note setup.py/tox.ini python_requires.
4. The exact best place (file + approximate line) to add a test asserting that an EncodedFile over a buffer opened "rb+" reports mode without "b", and a test that writing bytes raises TypeError on py3.
5. The precise command to run just those tests in this checkout.

Return findings as data. Do NOT modify any files.`,
  },
  {
    key: 'changelog-conventions',
    prompt: `You are in the pytest checkout at /testbed.

Report the repo's changelog-fragment convention: list changelog/ directory contents, read a couple of representative fragments, read changelog/README.rst if present, and state exactly what filename + content I should add for a bug fix addressing GitHub issue 5257 ("_pytest.capture.EncodedFile mode should not include b (binary)").

Also check CONTRIBUTING.rst for the changelog requirement and whether AUTHORS needs updating.

Return findings as data, including the exact literal filename and suggested one-to-three sentence RST body matching house style (check how other fragments phrase things and whether they end with a period / reference issues).`,
  },
]

phase('Investigate')
const findings = await parallel(
  LENSES.map(l => () => agent(l.prompt, { label: l.key, phase: 'Investigate', schema: FINDING_SCHEMA })),
)

const good = findings.map((f, i) => ({ lens: LENSES[i].key, ...(f || {}) })).filter(f => f.summary)

phase('Synthesize')
const plan = await agent(
  `You are synthesizing an implementation plan for a one-bug fix in the pytest checkout at /testbed.

Bug (GitHub pytest issue 5257): _pytest.capture.EncodedFile delegates .mode via __getattr__ to its underlying BINARY buffer, so it advertises e.g. "rb+". Libraries (youtube-dl) sniff 'b' in out.mode and then write bytes, which EncodedFile.write() rejects with TypeError. EncodedFile is a TEXT stream, so its mode must not contain "b".

Independent investigation findings (JSON):
${JSON.stringify(good, null, 2)}

Verify anything you doubt by reading the files yourself. Then produce a single concrete plan:
- the exact code to add to src/_pytest/capture.py (full snippet, correct indentation, matching house docstring style)
- whether it must tolerate a buffer lacking .mode, and if so how (justify with evidence from the findings — is there a real path where mode is absent?)
- the exact test code to add to testing/test_capture.py and where
- the exact changelog fragment filename + body
- the command to run the relevant tests

Put the plan in "details" as a precise, copy-pasteable spec. Flag any disagreement between the investigators in "risks".`,
  { label: 'synthesize', phase: 'Synthesize', schema: FINDING_SCHEMA },
)

return { findings: good, plan }
