export const meta = {
  name: 'needs-extensions-version-compare',
  description: 'Investigate needs_extensions string-comparison bug: usage, version formats, comparison strategy, test conventions',
  phases: [
    { title: 'Investigate', detail: 'parallel readers over usage, version formats, comparison libs, test conventions' },
    { title: 'Critique', detail: 'adversarial edge-case review of each finding' },
  ],
}

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Concise findings' },
    files: { type: 'array', items: { type: 'string' }, description: 'file:line references that matter' },
    recommendations: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' }, description: 'edge cases / backward-compat risks' },
  },
  required: ['summary', 'files', 'recommendations', 'risks'],
}

const CRITIQUE = {
  type: 'object',
  properties: {
    gaps: { type: 'array', items: { type: 'string' }, description: 'what the investigation missed' },
    corrections: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' }, description: 'claims confirmed by reading actual code' },
  },
  required: ['gaps', 'corrections', 'verified'],
}

const LENSES = [
  {
    key: 'usage-and-docs',
    prompt: `In the Sphinx repo at /testbed, investigate everything about the \`needs_extensions\` config option.
Read sphinx/extension.py, sphinx/config.py (needs_extensions entry), doc/usage/configuration.rst around confval needs_extensions, and doc/extdev/index.rst around version requirement checking.
Report: exact current comparison logic and its bug; what the docs promise about version format; whether 'unknown version' is a special sentinel and where it comes from; how extension.version is populated (search for Extension( construction and setup() return 'version' keys in sphinx/ext/*.py and sphinx/*.py).
Also check CHANGES file top section to see what release is in development and the format used for changelog entries (Bugs fixed section) — quote the exact heading lines.`,
  },
  {
    key: 'version-libs',
    prompt: `In the Sphinx repo at /testbed, determine the best available library for comparing version strings.
Check: setup.py install_requires (is \`packaging\` a hard dependency?); how sphinx/ext/doctest.py uses packaging.version.Version; how sphinx/util/docutils.py and sphinx/highlighting.py use distutils.version.LooseVersion; whether distutils is deprecated in the supported Python versions (check setup.py python_requires).
Then report the recommended approach for comparing a user-specified required version (e.g. '0.6') against an extension's reported version (e.g. '0.10.0'), including how to handle non-PEP440 / unparseable version strings such as 'unknown version', '1.0-beta', '2021.05', 'builtin'.
Show exactly what packaging.version.Version raises on bad input (InvalidVersion) and what module path to import it from. Verify by running python in /testbed: e.g. python -c "from packaging.version import Version, InvalidVersion; print(Version('0.10') > Version('0.6'))".`,
  },
  {
    key: 'test-conventions',
    prompt: `In the Sphinx repo at /testbed, figure out how to write a test for sphinx/extension.py's verify_needs_extensions.
Does tests/test_extension.py exist? Look at tests/test_config.py and tests/test_application.py for how they construct a Sphinx app / Config, how they use @pytest.mark.sphinx, confoverrides, and how they assert on VersionRequirementError and on logger warnings (search for 'warning' fixture / SphinxTestApp / _warning).
Find an existing test that checks needs_extensions or needs_sphinx behavior anywhere in tests/. Look for tests/roots/test-root/conf.py or similar minimal roots.
Report a concrete, runnable test skeleton that matches repo conventions, including the exact pytest invocation to run it.`,
  },
  {
    key: 'callers-and-blast-radius',
    prompt: `In the Sphinx repo at /testbed, map the blast radius of changing the version comparison in sphinx/extension.py verify_needs_extensions.
Search for: every place that compares versions with plain string > or < (grep for needs_sphinx too — sphinx/application.py); every place that reads config.needs_extensions; every test that would be affected.
Specifically read sphinx/application.py's handling of needs_sphinx and report whether it has the SAME string-comparison bug and how it currently compares (does it use sphinx.__display_version__ / a tuple?).
Report whether the fix should also touch needs_sphinx, with evidence, and whether any typing (mypy) config would object to importing packaging.`,
  },
]

phase('Investigate')

const results = await pipeline(
  LENSES,
  l => agent(l.prompt, { label: `probe:${l.key}`, phase: 'Investigate', schema: SCHEMA }),
  (res, lens) => res ? agent(
    `You are an adversarial reviewer. Another agent investigated the Sphinx repo at /testbed on the topic "${lens.key}" and reported:

${JSON.stringify(res, null, 2)}

Independently verify every factual claim by reading the actual files and running commands in /testbed. Do NOT trust the report. Report:
- gaps: anything important it missed for fixing the needs_extensions string-comparison bug
- corrections: claims that are wrong, with the correct fact and file:line evidence
- verified: claims you confirmed`,
    { label: `critique:${lens.key}`, phase: 'Critique', schema: CRITIQUE }
  ) : null
)

return {
  investigations: LENSES.map((l, i) => ({ lens: l.key, critique: results[i] })),
  raw: results,
}
