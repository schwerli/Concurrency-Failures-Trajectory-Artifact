export const meta = {
  name: 'autodoc-multisig-investigate',
  description: 'Investigate how to support multiple docstring signatures in autodoc_docstring_signature',
  phases: [
    { title: 'Investigate', detail: 'parallel probes of autodoc internals, py domain, upstream conventions' },
    { title: 'Synthesize', detail: 'merge findings into one design brief' },
  ],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Concise answer to the assigned question' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'file:line + short quote proving it' },
        },
        required: ['claim', 'evidence'],
      },
    },
    risks: { type: 'array', items: { type: 'string' }, description: 'Regressions or edge cases the implementer must handle' },
  },
  required: ['summary', 'facts', 'risks'],
}

const REPO = '/testbed (Sphinx 3.1.0 dev checkout). The task: GitHub issue "autodoc_docstring_signature with overloaded methods" — SWIG-wrapped C++ classes put ALL overloaded signatures at the start of the docstring, but sphinx.ext.autodoc DocstringSignatureMixin._find_signature (sphinx/ext/autodoc/__init__.py ~line 1034-1110) only picks up the FIRST one. We must support picking up all of them.'

const PROBES = [
  {
    key: 'render',
    prompt: `${REPO}

QUESTION: How does autodoc currently render MULTIPLE signatures for one object, end to end?

Trace precisely:
1. Documenter.add_directive_header in sphinx/ext/autodoc/__init__.py — how it splits sig on "\\n" and indents continuation lines.
2. FunctionDocumenter.format_signature and MethodDocumenter.format_signature — the existing singledispatch multi-signature path that does "\\n".join(sigs).
3. Whether ClassDocumenter.format_signature / add_directive_header support the same multi-line convention (read ClassDocumenter carefully, including get_doc/_get_signature and how autoclass_content interacts).
4. Whether the py domain directive (sphinx/domains/python.py PyObject.handle_signature / get_signatures) supports multiple signature lines in one directive.
5. Find any existing tests that assert multi-line signature output (grep tests/ for a directive header line followed by an indented continuation line, e.g. singledispatch tests).

Report exact file:line evidence. Do not modify files.`,
  },
  {
    key: 'mixin',
    prompt: `${REPO}

QUESTION: Exactly which Documenter classes use DocstringSignatureMixin / DocstringStripSignatureMixin, and what would break if _find_signature started collecting multiple signatures?

Do this:
1. List every class using each mixin (FunctionDocumenter, ClassDocumenter, MethodDocumenter, AttributeDocumenter, PropertyDocumenter, DecoratorDocumenter, and any autosummary/other extension that subclasses them — grep the whole repo including sphinx/ext/autosummary/).
2. For DocstringStripSignatureMixin (used by AttributeDocumenter/PropertyDocumenter): trace the MRO of format_signature. DocstringStripSignatureMixin.format_signature deliberately discards args, then calls super().format_signature() which is DocstringSignatureMixin.format_signature — which itself re-checks "if self.args is None" and calls _find_signature() AGAIN and assigns self.args. Determine empirically whether self.args actually ends up set in that path, and why the existing test target.DocstringSig.prop1 still renders with NO signature. Write a tiny throwaway script under /tmp if useful, or reason from code + run the existing test. This matters: if I make format_signature join extra signatures, the strip mixin must not emit them.
3. Note the exact semantics of self._new_docstrings and get_doc() caching, and when _find_signature can be called more than once for the same documenter instance (e.g. ClassDocumenter.format_signature, generate()).

Report exact file:line evidence. Do not modify sphinx source; /tmp scratch files are fine.`,
  },
  {
    key: 'regex',
    prompt: `${REPO}

QUESTION: Characterize py_ext_sig_re (sphinx/ext/autodoc/__init__.py line ~55) precisely, for the purpose of scanning CONSECUTIVE leading docstring lines for signatures instead of only line 0.

Do this:
1. Quote the regex and explain each group.
2. Note that the argument list is OPTIONAL — so a bare single word line (e.g. "Example" or "Note") MATCHES with args=None. Verify by running python.
3. Enumerate false-positive risks if we greedily consume consecutive leading lines: prose lines that would match, lines ending in "\\\\", lines with trailing whitespace, indented lines, lines like "meth(a, b) -> c" for a DIFFERENT base name.
4. Check what happens with a trailing backslash line-continuation convention (a docstring line ending in a literal backslash, which in the source is written "\\\\" inside a regular string) — does py_ext_sig_re match "E(foo: int) -> None \\\\"? Verify by running python.
5. Inspect sphinx/util/docstrings.py prepare_docstring: does it strip leading blank lines (so a docstring starting with a newline still has its signature at index 0)? Verify by running python.
6. Scan tests/roots/test-ext-autodoc/ for any existing docstrings whose 2nd/3rd leading lines would newly match the regex and thus be swallowed as signatures — this is the main regression risk. Report each one with file:line.

Run python to verify claims. Report exact evidence. Do not modify tracked files.`,
  },
  {
    key: 'upstream',
    prompt: `${REPO}

QUESTION: What is the canonical upstream Sphinx fix for this issue, and what test fixtures does it use?

Do this WITHOUT network access — infer from the repo:
1. Read CHANGES to determine the exact in-development version and the most recent issue numbers merged, to bracket which upstream issue number this is.
2. Read tests/roots/test-ext-autodoc/target/docstring_signature.py (classes A-D) and tests/test_ext_autodoc_configs.py tests test_autoclass_content_and_docstring_signature_{class,init,both}. Work out EXACTLY what new fixture classes an upstream fix would most plausibly add (e.g. class E with backslash-continued signature lines, class F with plain consecutive signature lines) and what the expected rendered output lines would be for each of the three autoclass_content modes.
3. Read doc/usage/extensions/autodoc.rst confval:: autodoc_docstring_signature and doc/extdev/deprecated.rst entries for DocstringSignatureMixin, and say what documentation/versionchanged notes the fix should add.
4. State the git describe / version so the versionchanged directive uses the right number.

Report exact evidence. Do not modify files.`,
  },
]

phase('Investigate')
const findings = await parallel(PROBES.map(p => () =>
  agent(p.prompt, { label: `probe:${p.key}`, phase: 'Investigate', schema: FINDING_SCHEMA })
    .then(r => ({ key: p.key, ...r }))
))

const good = findings.filter(Boolean)
log(`${good.length}/${PROBES.length} probes returned`)

phase('Synthesize')
const brief = await agent(
  `You are synthesizing a design brief for a Sphinx patch.

Goal: make sphinx.ext.autodoc's autodoc_docstring_signature pick up ALL leading signatures in a docstring (SWIG overloaded-method convention), not just the first, and render them as multiple signature lines on one directive.

Here are four independent investigation reports (JSON):

${JSON.stringify(good, null, 2)}

Read /testbed/sphinx/ext/autodoc/__init__.py lines 1034-1115 yourself to ground the brief.

Produce a concrete design brief:
- The exact new implementation of DocstringSignatureMixin._find_signature and format_signature (full code, matching the file's existing style, Python 3.5+ typing comments/annotations as used in that file).
- Whether to require a trailing backslash continuation, support plain consecutive lines, or BOTH — with a recommendation and justification grounded in regression risk from the reports.
- What DocstringStripSignatureMixin must do to avoid emitting extra signatures.
- The exact test fixtures to add to tests/roots/test-ext-autodoc/target/docstring_signature.py and the exact expected-output lines for the three test_autoclass_content_and_docstring_signature_* tests.
- Any doc/CHANGES updates.
- A list of every existing test that could regress, and why it will or won't.

Be specific and complete. This brief will be implemented verbatim.`,
  { label: 'synthesize', phase: 'Synthesize' }
)

return { probes: good, brief }
