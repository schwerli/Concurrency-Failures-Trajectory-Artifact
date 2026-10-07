export const meta = {
  name: 'autodoc-private-members-design',
  description: 'Map the private-members option surface in Sphinx autodoc and design the change to accept explicit member names',
  phases: [
    { title: 'Understand', detail: '4 parallel readers over filter_members, option plumbing, tests, and the special-members precedent' },
    { title: 'Design', detail: '3 independent designs for the option change' },
    { title: 'Judge', detail: 'score designs and synthesize the winning plan' },
  ],
}

const READERS = [
  {
    key: 'filter-members',
    prompt: `Read /testbed/sphinx/ext/autodoc/__init__.py carefully, focusing on Documenter.filter_members (around lines 559-687) and get_object_members/get_module_members.

Report EXHAUSTIVELY:
1. Every place \`self.options.private_members\` is read, with exact line numbers and the surrounding branch condition. Quote the exact current source lines.
2. The full control-flow of filter_members' if/elif chain: for each branch, which member names reach it and what \`keep\` becomes. Pay special attention to the interaction between the \`(namespace, membername) in attr_docs\` branch and the \`want_all and isprivate\` branch.
3. How \`isprivate\` is computed, including the docstring metadata (\`:meta private:\` / \`:meta public:\`) path. Note that a member NOT starting with underscore can be isprivate=True via metadata, and a member starting with underscore can be isprivate=False via metadata.
4. What \`want_all\` is and where it comes from (trace document_members and get_object_members).
5. The role of \`is_filtered_inherited_member\` and which branches call it.
6. Anything that would break if \`options.private_members\` changed from a bool to either the ALL sentinel or a list of names (i.e. every truthiness check on it).

Return a precise technical report with exact line numbers and quoted code. No recommendations yet.`,
  },
  {
    key: 'option-plumbing',
    prompt: `Investigate how autodoc directive options are declared, parsed, defaulted, and merged in /testbed.

Read:
- /testbed/sphinx/ext/autodoc/__init__.py: the option converter functions near the top (members_option, members_set_option, bool_option, inherited_members_option, merge_special_members_option), the \`Options\` class, and EVERY \`option_spec\` dict that contains 'private-members' (there are at least two: ModuleDocumenter ~line 856 and ClassDocumenter ~line 1282). Also check ExceptionDocumenter/DataDocumenter/other subclasses that inherit or override option_spec.
- /testbed/sphinx/ext/autodoc/directive.py: AUTODOC_DEFAULT_OPTIONS, process_documenter_options, the \`no-<option>\` negation mechanism.
- /testbed/sphinx/ext/autoc*/ or wherever \`autodoc_default_options\` config is registered and validated.
- /testbed/sphinx/ext/autosummary/ and /testbed/sphinx/ext/apidoc.py for any code that constructs private-members options programmatically.

Report EXHAUSTIVELY:
1. Exact source of members_option, members_set_option, bool_option. What each returns for arg=None, arg=True, arg='a, b', arg=''.
2. Every option_spec entry for 'private-members' with exact line numbers.
3. What \`Options.__getattr__\` returns for an option that was NOT given by the user (is it None? KeyError? False?). Quote the class.
4. How \`autodoc_default_options\` values flow into the option converter — is the converter applied to config values, or are config values used raw? Trace process_documenter_options + assemble_option_dict precisely. This matters: a user with \`autodoc_default_options = {'private-members': True}\` in conf.py must keep working.
5. How the \`no-private-members\` negation works and whether it would still work.
6. Exactly how \`special-members\` (which already uses members_option) is declared and consumed in filter_members — it is the precedent to follow. Note how it distinguishes \`is ALL\` from a list.
7. Any programmatic constructions of these options (autosummary, apidoc, tests) that pass a bool.

Quote exact code with line numbers. No recommendations yet.`,
  },
  {
    key: 'tests-and-docs',
    prompt: `Inventory every test and doc in /testbed that touches autodoc's private-members (and special-members, as the precedent).

Read:
- /testbed/tests/test_ext_autodoc_private_members.py (whole file)
- /testbed/tests/test_ext_autodoc.py — the \`do_autodoc\` helper, the fake Options at ~line 52, and every test setting 'private-members' (~lines 890, 915, 939, 1982)
- /testbed/tests/roots/test-ext-autodoc/target/private.py and any other roots fixture with private members
- /testbed/tests/test_ext_autodoc_events.py or similar for the autodoc-skip-member event
- /testbed/doc/usage/extensions/autodoc.rst — the private-members documentation (~line 139, ~177) and autodoc_default_options docs (~lines 400-450)
- /testbed/CHANGES — the top (unreleased) section: report the exact version header and the exact formatting convention of "Features added" entries so a new entry matches.

Report:
1. Full content of tests/test_ext_autodoc_private_members.py, and the fixture module it documents (quote the fixture source).
2. Exact quote of the fake Options object at test_ext_autodoc.py:~52 and how do_autodoc builds options (does it go through process_documenter_options / the option_spec converters, or does it pass raw values?). CRITICAL: determine whether a test writing \`"private-members": None\` gets converted by the option_spec converter or passed through raw.
3. Every existing test that would change behavior if private-members became a members_option (list-or-ALL) instead of bool_option.
4. The exact current doc text for private-members, with enough surrounding context to write a patch.
5. The exact CHANGES top section text.

Quote verbatim. No recommendations yet.`,
  },
  {
    key: 'upstream-intent',
    prompt: `Determine the intended upstream behavior for "Support defining specific :private-members: for autodoc" (sphinx-doc/sphinx issue #8009 / #8014, landed in Sphinx 3.2).

Work from the repo only (no network needed, but you may check git log/branches):
- Run \`cd /testbed && git log --oneline -15\` and \`git log --all --oneline | head -30\`.
- Read /testbed/CHANGES top section for the in-progress version.
- Study how \`:special-members:\` behaves as the closest analogue: \`:special-members:\` with no args means ALL, with args means only those names. Read its handling in filter_members.
- Read /testbed/doc/usage/extensions/autodoc.rst private-members + special-members + members docs.

Then answer precisely:
1. What must \`:private-members:\` with NO arguments do? (backward compat — currently a bool flag documenting all private members.)
2. What must \`:private-members: _foo, _bar\` do?
3. What must happen to private members NOT listed when arguments are given?
4. Does \`:undoc-members:\` still gate explicitly-named private members? Consider: if a user explicitly names \`_private_undocumented\`, should it appear without \`:undoc-members:\`? Compare with how explicitly-named entries in \`:members:\` and \`:special-members:\` behave. Argue both sides and give the answer most consistent with the surrounding code.
5. Should attribute-doc private members (the attr_docs branch) honor an explicit name list?
6. Should \`is_filtered_inherited_member\` be consulted for private members? Note whether the current code checks it in the private branch.

Give a crisp spec table of (input, member, expected). No implementation yet.`,
  },
]

phase('Understand')
const findings = (await parallel(READERS.map(r => () =>
  agent(r.prompt, { label: `read:${r.key}`, phase: 'Understand' })
))).filter(Boolean)

const context = READERS.map((r, i) => `===== ${r.key} =====\n${findings[i] ?? '(no result)'}`).join('\n\n')

phase('Design')
const ANGLES = [
  { key: 'minimal', lens: 'MINIMAL-DIFF: change as little as possible. Prefer reusing the existing members_option converter over writing a new one. Only touch filter_members branches that must change.' },
  { key: 'consistency', lens: 'CONSISTENCY-FIRST: make :private-members: behave exactly like :special-members: does today, including the ALL-vs-list distinction, undoc-members gating, and inherited-member filtering. Justify each alignment against quoted code.' },
  { key: 'compat', lens: 'BACKWARD-COMPAT-FIRST: enumerate every existing caller/config/test that passes a bool or None and prove your design keeps each working. Include autodoc_default_options={"private-members": True}, no-private-members negation, apidoc, autosummary, and third-party extensions reading options.private_members in autodoc-skip-member handlers.' },
]

const designs = await parallel(ANGLES.map(a => () => agent(
  `You are designing a change to Sphinx autodoc so that \`:private-members:\` accepts an explicit comma-separated list of member names, like \`:members:\` and \`:special-members:\` already do.

Here is exhaustive research on the current code. Trust the quoted line numbers.

${context}

Your design lens: ${a.lens}

Produce a COMPLETE implementation plan:
- The exact unified diff for /testbed/sphinx/ext/autodoc/__init__.py (option_spec entries AND filter_members). Write real code, correctly indented, matching surrounding style.
- Exact diff for docs (/testbed/doc/usage/extensions/autodoc.rst) and CHANGES.
- The new/updated tests: exact test function bodies and any fixture-file additions, matching the existing test style (do_autodoc, assert list(actual) == [...]).
- A truth table: for each of {no option, option with 2 names, option + undoc-members, autodoc_default_options bool True, no-private-members} × {documented private member, undocumented private member, private attr with attr-doc, :meta private: member, public member}, state the expected outcome.
- The top 3 ways your design could be WRONG, and how a reviewer would detect each.

Verify your line numbers and quoted code against the research above. Do not invent APIs.`,
  { label: `design:${a.key}`, phase: 'Design' }
))).filter(Boolean)

phase('Judge')
const judgeSchema = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          design: { type: 'string' },
          correctness: { type: 'number' },
          compat: { type: 'number' },
          consistency: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['design', 'correctness', 'compat', 'consistency', 'notes'],
      },
    },
    winner: { type: 'string' },
    finalPlan: { type: 'string', description: 'The complete synthesized implementation plan with exact code, grafting the best parts of the runners-up.' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['scores', 'winner', 'finalPlan', 'openQuestions'],
}

const judged = await agent(
  `Three independent designs were produced for making Sphinx autodoc's \`:private-members:\` accept explicit member names. Here is the research they were based on:

${context}

=========== DESIGN A (minimal-diff) ===========
${designs[0] ?? '(missing)'}

=========== DESIGN B (consistency-first) ===========
${designs[1] ?? '(missing)'}

=========== DESIGN C (compat-first) ===========
${designs[2] ?? '(missing)'}

Score each 0-10 on correctness, backward-compatibility, and consistency-with-surrounding-code. Then synthesize ONE final plan: pick the best base and graft the strongest elements of the others.

The final plan must contain literal, ready-to-apply code for:
1. /testbed/sphinx/ext/autodoc/__init__.py — every option_spec change plus the exact replacement for the affected filter_members branches (quote the OLD code being replaced and the NEW code).
2. /testbed/doc/usage/extensions/autodoc.rst
3. /testbed/CHANGES
4. Tests (exact function bodies + fixture edits).

Resolve, do not defer, the questions of (a) whether undoc-members still gates explicitly-named private members, (b) whether the attr_docs branch honors the name list, (c) whether is_filtered_inherited_member applies. Cite the quoted code that justifies each choice. List anything genuinely unresolvable in openQuestions.`,
  { label: 'judge+synthesize', phase: 'Judge', schema: judgeSchema, effort: 'high' }
)

return judged
