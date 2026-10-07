export const meta = {
  name: 'autodoc-multisig-verify',
  description: 'Adversarially review and end-to-end verify the multi-signature autodoc patch',
  phases: [
    { title: 'Probe', detail: 'lenses: correctness, e2e build, edge-case fuzz, API compat' },
    { title: 'Refute', detail: 'independent skeptics try to kill each finding' },
  ],
}

const CONTEXT = `Repo: /testbed (Sphinx 3.1.0 dev). A patch is ALREADY APPLIED to the working tree (see \`git diff\`).

WHAT IT DOES: makes sphinx.ext.autodoc's \`autodoc_docstring_signature\` pick up ALL leading signature lines of a docstring (the SWIG overloaded-method convention), not just the first, and render them as multiple signature lines under one directive (the same "\\n"-joined convention already used for singledispatch).

Changed: sphinx/ext/autodoc/__init__.py (DocstringSignatureMixin._find_signature + format_signature; FunctionDocumenter.format_signature gets \`documenter.objpath = [None]\`), plus test fixtures/expectations, doc/usage/extensions/autodoc.rst, CHANGES.

Key design decisions (deliberate, do not report as "should be X" style preferences — only report if they cause an actual DEFECT):
- Plain consecutive signature lines are accepted (SWIG emits no backslashes); a trailing backslash is tolerated and stripped.
- Scanning stops (break) at the first line that fails: blank, regex non-match, base-name mismatch, or (for 2nd+ signatures) no argument list.
- Only the FIRST signature keeps its return annotation; continuations render as "(args)". This matches the existing singledispatch/py-domain convention.
- DocstringStripSignatureMixin is intentionally NOT modified.

ENVIRONMENT NOTE: this checkout has 125 PRE-EXISTING test failures unrelated to the patch (docutils version drift). Baseline failure list: /tmp/baseline_fails.txt. Patched failure list: /tmp/patched_fails.txt. They are IDENTICAL. Do NOT report any test in that baseline list as a regression. Use /opt/miniconda3/envs/testbed/bin/python -m pytest.

You may create scratch files under /tmp. Do NOT modify tracked files in /testbed (if you must experiment, restore with git checkout afterwards and verify \`git diff\` still matches /tmp/patch.diff).`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { enum: ['critical', 'major', 'minor'] },
          failure_scenario: { type: 'string', description: 'Concrete input/state -> wrong output. Must be reproducible.' },
          repro: { type: 'string', description: 'Exact command or code you ran that demonstrates it, plus observed output' },
        },
        required: ['title', 'file', 'severity', 'failure_scenario', 'repro'],
      },
    },
    notes: { type: 'string', description: 'What you checked that was fine' },
  },
  required: ['findings', 'notes'],
}

const LENSES = [
  {
    key: 'correctness',
    prompt: `${CONTEXT}

LENS: correctness of the new _find_signature control flow.

Read sphinx/ext/autodoc/__init__.py DocstringSignatureMixin closely and hunt for real defects:
- Is \`self._new_docstrings[i]\` ever left in a state that SILENTLY EATS docstring content that is not actually a signature? Test every break path: blank line, regex non-match, base-name mismatch, "2nd+ signature with args is None". For each break path, confirm the docstring line that caused the break is still present in the rendered body.
- Multiple docstrings in the list (ClassDocumenter with autoclass_content='both' returns two). Does the outer \`if result is not None: break\` behave the same as the old \`continue\`-based flow in every case? Construct a case where the FIRST docstring has no signature but the SECOND does.
- Re-entrancy: _find_signature can be called twice on the same documenter (DocstringStripSignatureMixin path). Verify _signatures/_new_docstrings end up correct both times. Also check whether a documenter instance is ever reused across two objects.
- \`line.rstrip('\\\\').rstrip()\` — does this corrupt a signature whose argument default legitimately ends in a backslash, e.g. \`def f(sep='\\\\')\`? Test it.
- Class attributes \`_new_docstrings = None\` / \`_signatures = None\`: does the \`getattr(self, '_new_docstrings', None)\` check in DocstringSignatureMixin.get_doc AND in ClassDocumenter.get_doc still work correctly now that the attribute always exists?
- Does \`format_signature\` reading \`self._signatures\` ever raise AttributeError, e.g. when autodoc_docstring_signature=False, or when a subclass calls format_signature without _find_signature?

WRITE AND RUN actual reproduction scripts under /tmp for each hypothesis. Only report findings you have REPRODUCED. Report the repro output verbatim.`,
  },
  {
    key: 'e2e',
    prompt: `${CONTEXT}

LENS: real end-to-end build. Do not trust the directive-stream tests; build actual HTML.

Build a fresh Sphinx project under /tmp:
- A python module simulating a SWIG-wrapped extension: a class with an overloaded __init__ (3 plain consecutive signature lines in the docstring), a method with 3 plain overloaded signature lines followed by real prose description, a method with backslash-continued signatures, a module-level function with overloaded signatures, a @property, a @staticmethod and a @classmethod with overloaded docstring signatures, and a normal single-signature method as a control.
- conf.py with extensions=['sphinx.ext.autodoc'], and the module on sys.path.
- index.rst using automodule with :members:.

Run \`sphinx-build -b html\` (use /opt/miniconda3/envs/testbed/bin/python -m sphinx) AND \`-b xml\`. Then:
1. Confirm the HTML actually renders all overload signatures (grep the output HTML for each signature; check they are separate <dt> elements in one <dl>).
2. Confirm the prose description after the signature block is NOT swallowed and appears in the body.
3. Confirm no new WARNINGs are emitted (compare against the same build with autodoc_docstring_signature=False).
4. Inspect the XML: confirm only the first desc_signature carries the ids/index entry, and that cross-referencing (:py:meth: role) to the object still resolves.
5. Repeat the build with \`autodoc_docstring_signature = False\` and confirm the signatures stay in the docstring body as plain text (feature is properly opt-out).
6. Also check \`sphinx.ext.autosummary\` over the same module doesn't crash on the multi-line signature.

Report the actual rendered snippets. Report a finding for anything broken, ugly, or warning-producing.`,
  },
  {
    key: 'fuzz',
    prompt: `${CONTEXT}

LENS: edge-case fuzzing of the docstring scanner.

Write a /tmp harness that runs autodoc over a module of many adversarial docstring shapes and prints the resulting directive lines (mimic tests/test_ext_autodoc.py's do_autodoc helper — read it first). Cases to cover at minimum:
- Docstring whose 2nd line is a bare word equal to the object name (e.g. "foo(a)\\nfoo\\nprose"). Confirm "foo" is NOT eaten.
- 2nd line is a bare word that is NOT the object name (e.g. "Example").
- 2nd line is a signature for a DIFFERENT name.
- Signature lines separated by a blank line.
- Signature lines that are indented deeper than line 0.
- A single signature followed immediately by a reST field list / "Args:" Google-style block / numpydoc "Parameters\\n----------" block. Confirm napoleon-style docstrings are unharmed (also test with sphinx.ext.napoleon enabled).
- Signatures with nested parens/commas in defaults: \`f(a=(1, 2), b={'x': 1})\`.
- Signature with \`*args, **kwargs\`.
- A docstring that is ONLY signature lines (no body).
- Unicode/non-ASCII parameter names.
- 50 overload lines (make sure nothing quadratic explodes — time it).
- A method on a class where the docstring signature uses the qualified name \`Cls.meth(a)\`.
- \`__init__\` docstring using the name \`__init__(self, a)\` and using an MRO base-class name.
- autoclass_content='both' where the class docstring has 1 signature and the __init__ docstring has 3.

For each, print input docstring and output directive lines. Judge each: correct, or a defect? Report only defects, with the printed evidence.`,
  },
  {
    key: 'compat',
    prompt: `${CONTEXT}

LENS: backward/API compatibility and downstream breakage.

- \`_find_signature\` return type is unchanged (Tuple[str, str] or None) but it now ALSO mutates \`self._signatures\`. Grep the whole repo (including sphinx/ext/autosummary, sphinx/ext/napoleon, sphinx/ext/apidoc) for anything that calls _find_signature, reads _new_docstrings, or overrides format_signature on a documenter, and check each still works.
- Third-party documenters (e.g. sphinx-autodoc-typehints style) subclass these mixins and call \`super().format_signature()\`. Simulate one: write a /tmp extension defining a custom Documenter subclassing DocstringSignatureMixin that overrides format_signature and format_args, register it via app.add_autodocumenter, and confirm it still works and that a multi-line sig doesn't break it.
- The \`autodoc-process-signature\` event: it fires ONCE inside Documenter.format_signature with only the FIRST signature; the continuations are appended afterwards and are NOT passed through the event. Is that a real defect for users who rewrite signatures via that event? Write a test extension that hooks autodoc-process-signature and returns a rewritten signature, and observe what happens with a multi-overload docstring. Judge severity.
- \`FunctionDocumenter.format_signature\` now sets \`documenter.objpath = [None]\`. Verify with a repro that WITHOUT that line the singledispatch test crashes, and that WITH it behaviour is unchanged (run tests/test_ext_autodoc.py -k singledispatch).
- Check mypy/flake8 cleanliness of the changed file: run \`/opt/miniconda3/envs/testbed/bin/python -m flake8 sphinx/ext/autodoc/__init__.py\` and \`-m mypy sphinx/ext/autodoc/__init__.py\` if available; compare against the same run on the stashed baseline so you only report NEW issues.
- Check the type comment style \`_new_docstrings = None  # type: List[List[str]]\` matches the file's conventions and that \`List\` is imported.

Report only real defects with repro evidence.`,
  },
]

phase('Probe')
const REFUTE_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is wrong, not a real defect, or purely stylistic' },
    reasoning: { type: 'string' },
  },
  required: ['refuted', 'reasoning'],
}

const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `lens:${l.key}`, phase: 'Probe', schema: FINDINGS_SCHEMA })
        .then(r => ({ lens: l.key, ...r })),
  (r) => {
    if (!r || !r.findings || !r.findings.length) return { lens: r ? r.lens : '?', judged: [], notes: r ? r.notes : '' }
    return parallel(r.findings.map(f => () =>
      parallel(['does-it-actually-reproduce', 'is-it-pre-existing-on-the-unpatched-baseline', 'is-it-merely-stylistic-or-out-of-scope'].map(angle => () =>
        agent(`${CONTEXT}

A reviewer reported this finding against the applied patch:

TITLE: ${f.title}
FILE: ${f.file}${f.line ? ':' + f.line : ''}
SEVERITY: ${f.severity}
FAILURE SCENARIO: ${f.failure_scenario}
CLAIMED REPRO: ${f.repro}

Your job is to REFUTE it, through the lens of: ${angle}.

Actually run the claimed repro yourself. Then specifically check:
- Does it reproduce at all, exactly as described?
- Does the SAME behaviour occur on the UNPATCHED baseline? (\`cd /testbed && git stash\`, reproduce, then \`git stash pop\` — ALWAYS restore, and verify \`git diff\` matches /tmp/patch.diff afterwards.) If yes, it is pre-existing and NOT a defect introduced by this patch.
- Is it a genuine user-visible defect, or a style/preference/hypothetical?

Default to refuted=true when uncertain. Only refuted=false if you personally reproduced a genuine, patch-introduced, user-visible defect.`,
          { label: `refute:${f.title.slice(0, 28)}:${angle.slice(0, 12)}`, phase: 'Refute', schema: REFUTE_SCHEMA })
      )).then(votes => {
        const v = votes.filter(Boolean)
        const survives = v.filter(x => !x.refuted).length >= 2
        return { ...f, lens: r.lens, survives, votes: v.map(x => ({ refuted: x.refuted, why: x.reasoning })) }
      })
    )).then(judged => ({ lens: r.lens, judged, notes: r.notes }))
  }
)

const ok = results.filter(Boolean)
const all = ok.flatMap(r => r.judged || [])
const confirmed = all.filter(f => f.survives)
log(`${all.length} findings raised, ${confirmed.length} survived adversarial refutation`)

return {
  confirmed,
  refuted: all.filter(f => !f.survives).map(f => ({ title: f.title, lens: f.lens, why: f.votes.map(v => v.why).join(' || ') })),
  notes: ok.map(r => ({ lens: r.lens, notes: r.notes })),
}
