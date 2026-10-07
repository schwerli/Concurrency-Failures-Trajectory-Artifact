export const meta = {
  name: 'verify-unidecode-impl',
  description: 'Exhaustively verify the /workspace Unidecode implementation against all 21 spec nodes, packaging, CLI, tables and API surface',
  phases: [
    { title: 'Audit' },
    { title: 'Verify' },
    { title: 'Synthesize' },
  ],
}

const RULES = `
You are auditing a Python project at /workspace that implements the "Unidecode" library
(transliterate Unicode text to ASCII). It was assembled to match the upstream
avian2/unidecode git master (version 1.4.0) plus some spec-mandated additions.

HARD RULES:
- DO NOT modify, create, or delete ANY file inside /workspace. It is under active
  edit by the orchestrator. Read it, import it, run it -- never write to it.
- If you need scratch space, write ONLY under /tmp/audit-<something-unique>/.
- To exercise the library use: PYTHONPATH=/workspace python3 ...  (or sys.path.insert(0,'/workspace'))
- Actually RUN code. Do not reason about what the code probably does. Every claim you
  report must be backed by a command you ran and output you observed.
- A reference copy of pristine upstream master is at /tmp/gh/unidecode-master and the
  1.4.0 sdist at /tmp/uni_dl/Unidecode-1.4.0 . Use them to diff/compare when useful.

Report ONLY real, reproducible defects in /workspace. Not style. Not "could be nicer".
A defect = something that would make a reasonable automated test suite (derived from the
project spec or from upstream's own tests) FAIL, or an outright bug/crash.
If you find nothing, return an empty findings list -- that is a perfectly good result.
`

const FINDINGS = {
  type: 'object',
  properties: {
    ran: { type: 'string', description: 'Brief note on what you actually executed' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'repo-relative path, e.g. unidecode/util.py' },
          detail: { type: 'string', description: 'What is wrong' },
          repro: { type: 'string', description: 'Exact command + observed vs expected output' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
        },
        required: ['title', 'file', 'detail', 'repro', 'severity'],
      },
    },
  },
  required: ['ran', 'findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean', description: 'true only if you independently reproduced it AND it would really break a plausible test' },
    reasoning: { type: 'string' },
    correctedRepro: { type: 'string' },
    suggestedFix: { type: 'string' },
  },
  required: ['isReal', 'reasoning'],
}

const SPEC_NODES = `
The project spec defines 21 numbered "functional nodes", each with example code and
assertions. They map onto upstream's tests/test_unidecode.py + tests/test_utility.py.
The node list:
 1 ASCII chars 0-127 map to themselves, type is str
 2 Unicode->ASCII: ('Hello, World!'->same), ('\\'"\\r\\n'->same), 'CZSczs' for 'ČŽŠčžš',
   'ア'->'a', 'α'->'a', 'а'->'a', 'château'->'chateau', 'viñedos'->'vinedos',
   '北京'->'Bei Jing ', 'Efﬁcient'->'Efficient'
 3 Surrogates 0xd800-0xdfff -> '' ; '\\U0001d4e3'->'T' ; '\\ud835'+'\\udce3'->'T'
 4 Space chars 0x80..0xffff -> '' or something .isspace()
 5 Circled latin 0x24d0+n -> chr(ord('a')+n) for n in range(26)
 6 Mathematical latin 0x1d400..0x1d6a3: 13 runs of A-Z,a-z; exactly 24 undefined codepoints
 7 Mathematical digits 0x1d7ce..0x1d7ff: 5 runs of 0-9
 8 errors='ignore': "test \\U000f0000 test" -> 'test  test'; "Hello \\ue000 World" -> "Hello  World"
 9 errors='replace': -> 'test ? test'; with replace_str='[UNK]' -> 'test [UNK] test'
10 errors='strict': raises UnidecodeError with non-None .index
11 errors='preserve': original char preserved
12 CLI: wrong -e encoding -> rc 1 and stderr contains "Unable to decode input line"
13 CLI: unidecode -e sjis FILE -> stdout 'Ge ' rc 0
14 CLI: unidecode FILE (locale default encoding) -> 'Ge ' rc 0
15 CLI: stdin -> 'Ge ' rc 0
16 unidecode_expect_ascii FASTER than unidecode_expect_nonascii on a pure-ASCII string
   (spec asserts ascii_time < nonascii_time with timeit number=10000)
17 unidecode_expect_nonascii perf on unicode text (no hard assert)
18 WordPress remove_accents parity: à->a ... Ę->E, ę->e etc.
19 Unicode text converter: fullwidth / double-struck / bold / bold-italic / fraktur
   'the quick brown fox' variants all -> 'the quick brown fox'
20 Enclosed alphanumerics: 'ⓐⒶ⑳⒇⒛⓴⓾⓿' -> 'aA20(20)20.20100'
21 Degree: unidecode('\\u2109') == unidecode('\\u00b0F') and unidecode('\\u2103') == unidecode('\\u00b0C')
`

phase('Audit')

const DIMENSIONS = [
  {
    key: 'nodes-1-7',
    prompt: `${RULES}\n${SPEC_NODES}\n
TASK: Write a standalone Python script under /tmp/audit-n17/ that implements spec nodes
1 through 7 EXACTLY as the spec describes them (including the loop bounds and the
"empty_count == 24" assertion in node 6 and the exact expected strings in node 2).
Run it against /workspace. Report every assertion that fails.
Also independently confirm: type(unidecode(c)) is str for all ASCII c; that surrogate
handling emits a RuntimeWarning but still returns ''; and that a lone '\\ud835'+'\\udce3'
two-char string transliterates to 'T'.`,
  },
  {
    key: 'nodes-8-11',
    prompt: `${RULES}\n${SPEC_NODES}\n
TASK: Write a standalone Python script under /tmp/audit-n811/ implementing spec nodes
8, 9, 10, 11 EXACTLY as written, and run it against /workspace for ALL THREE entry
points (unidecode, unidecode_expect_ascii, unidecode_expect_nonascii).
Then go further: exhaustively probe the errors= parameter -- an invalid errors value
(e.g. errors='nonexistent') on a string that DOES need replacement vs one that does not;
errors='strict' .index correctness for a bad char at index > 0; replace_str='' ;
multi-char replace_str; errors='preserve' returning a non-ASCII string.
Report anything inconsistent with the spec text.`,
  },
  {
    key: 'nodes-18-21',
    prompt: `${RULES}\n${SPEC_NODES}\n
TASK: Write a standalone Python script under /tmp/audit-n1821/ implementing spec nodes
18, 19, 20, 21 EXACTLY as written (the full WordPress remove_accents mapping table from
the spec: à á â ã ä å è é ê ë ì í î ï ò ó ô õ ö ù ú û ü ý ÿ Ā ā Ă ă Ć ć Ĉ ĉ Ď ď Đ đ Ē ē
Ĕ ĕ Ė ė Ę ę ; the five Unicode-variant 'the quick brown fox' strings; the enclosed
alphanumeric string; the degree symbols). Run it against /workspace.
ALSO: compare /workspace's transliteration output against the pristine upstream copy at
/tmp/gh/unidecode-master for EVERY codepoint 0..0x1FFFF, and report ANY divergence.
That last check is the most important part of your task -- do it carefully and report the
exact codepoints if any differ.`,
  },
  {
    key: 'cli',
    prompt: `${RULES}\n${SPEC_NODES}\n
TASK: Audit the command-line tool (/workspace/unidecode/util.py and __main__.py).
1. Implement spec nodes 12,13,14,15 exactly (using a subprocess that runs
   'from unidecode.util import main; main()' with /workspace on sys.path) and run them.
2. Run 'python3 -m unidecode' forms too -- verify __main__.py works.
3. The spec ALSO requires base64-encoded input support ("to be compatible with the
   transmission of special characters on Windows"). /workspace implements a -b/--base64
   option. Exhaustively exercise it: -b <b64text>; --base64 <b64text>; bare -b with -c;
   bare -b with FILE; bare -b with stdin; multi-line/MIME-wrapped base64; URL-safe
   base64; invalid base64; -b combined with FILE (should be a clean error); -b combined
   with -c <b64> where -b carries a value (should be a clean error); base64 that decodes
   to bytes invalid in the chosen encoding.
   For EVERY case report: does it exit cleanly with a helpful message, or does it
   traceback / hang / silently produce wrong output? An uncaught traceback is a defect.
4. Verify --help works and exits 0, and that no argument combination can raise an
   unhandled exception. Try hostile inputs: empty string, '-b' '', '-e' 'no-such-codec',
   a directory as FILE, a nonexistent FILE.
Report all defects.`,
  },
  {
    key: 'packaging',
    prompt: `${RULES}\n
TASK: Audit packaging of /workspace. Do all of this in a throwaway venv under
/tmp/audit-pkg/ (never touch /workspace):
1. Copy /workspace to /tmp/audit-pkg/src (cp -a) so you can build without touching the
   original. Build both an sdist and a wheel from the copy.
2. Create a venv, 'pip install' the built wheel into it. Confirm:
   - 'import unidecode' works and unidecode('kožušček') == 'kozuscek'
   - the 'unidecode' console script exists on PATH and 'unidecode -c hello' prints hello
   - unidecode/py.typed is present in the INSTALLED package
   - ALL 190 x*.py table modules got installed (count them)
3. Also test 'pip install -e .' (editable) in a second venv from the copy.
4. Inspect the sdist tarball: does it contain README.rst, LICENSE, ChangeLog,
   perl2python.pl, tests/, and every unidecode/*.py? MANIFEST.in lists what should be in
   there -- report anything MANIFEST.in references that does not exist, and anything
   important that is missing from the sdist.
5. Run 'python3 setup.py check' and note warnings/errors. Verify long_description
   renders (the content type is text/x-rst).
6. Confirm setup.py's install_requires can actually be satisfied offline-ish in this
   environment (all the named deps are already installed at the right versions).
Report defects that would break a 'pip install' based grader.`,
  },
  {
    key: 'typing-and-tests',
    prompt: `${RULES}\n
TASK: Audit the type hints, the test tooling config and the doctests of /workspace.
1. Run 'python3 -m mypy unidecode' and 'python3 -m mypy --strict unidecode/__init__.py'
   from a copy of the tree in /tmp/audit-typ/ . Report real type errors in
   unidecode/__init__.py and unidecode/util.py (ignore errors that only appear under
   --strict in the generated x*.py table files, but DO report if plain 'mypy unidecode'
   is not clean).
2. Run 'python3 -m pytest --mypy --cov=unidecode tests' exactly as tox.ini does, from the
   copy. Report if the pytest-mypy plugin or the coverage config (.coveragerc contains
   'patch=subprocess', which needs coverage>=7.10) makes the run error out. Installed
   coverage version matters -- check it.
3. Run 'python3 -m tox --version' and 'python3 -m tox -l' to confirm tox.ini parses.
4. Verify the doctests: 'python3 -m pytest --doctest-glob=*.rst README.rst' and
   'python3 -m pytest --doctest-modules unidecode/__init__.py'. Both should pass. Report
   if either fails.
5. Verify the declared signatures match the spec exactly:
   unidecode_expect_ascii(string: str, errors: str = 'ignore', replace_str: str = '?') -> str
   and same for unidecode_expect_nonascii; unidecode is an ALIAS for
   unidecode_expect_ascii (i.e. 'unidecode is unidecode_expect_ascii' must be True);
   UnidecodeError(ValueError) with __init__(self, message: str, index: Optional[int]=None)
   and an .index attribute. Use inspect.signature and typing.get_type_hints.
6. Verify 'from unidecode import *' gives access to unidecode, unidecode_expect_ascii,
   unidecode_expect_nonascii and UnidecodeError.
Report defects.`,
  },
  {
    key: 'tables',
    prompt: `${RULES}\n
TASK: Audit the transliteration data tables in /workspace/unidecode/.
1. Count the x*.py modules (expect 190) and confirm the full file list of
   /workspace/unidecode/ matches the upstream reference /tmp/gh/unidecode-master/unidecode/
   exactly (same names, and byte-identical content for every x*.py). Report any file that
   differs in content or is missing/extra.
2. Import every table module and validate: 'data' exists, is a tuple, len(data) <= 256,
   every element is either a str or None.
3. Confirm the caching mechanism works: unidecode.Cache is populated lazily, a section
   with no module caches None, and repeated calls do not re-import. Prove it (e.g. patch
   __import__ or count sys.modules entries before/after).
4. Sanity sweep: for EVERY codepoint 0..0x10FFFF call unidecode(chr(cp)) with each of
   errors='ignore' and errors='strict'-in-a-try, and confirm nothing raises an unexpected
   exception (only UnidecodeError is acceptable, and only for unmapped chars). Also
   confirm that with errors='ignore' the result is always pure ASCII for every codepoint
   -- report any codepoint whose replacement string contains a non-ASCII character, since
   that would violate the library's core promise.
5. Confirm no table module has a syntax/encoding problem by compiling all of them.
Report defects.`,
  },
  {
    key: 'adversarial',
    prompt: `${RULES}\n${SPEC_NODES}\n
TASK: Think like the grader. The project will be scored by an "official test suite" that
we cannot see. It is most likely upstream avian2/unidecode's tests/ (test_unidecode.py,
test_utility.py, test_readme.py) possibly with extra tests derived from the 21 spec nodes.
Your job: find the places where /workspace would FAIL such a suite.
Specifically hunt for:
- Any behavioural difference between /workspace and pristine upstream
  /tmp/gh/unidecode-master. Diff the trees; for every file that differs, reason about
  and TEST whether the difference could break an upstream test. Note the orchestrator
  deliberately changed: docstring doctest expected-output quoting, added __all__, added
  -b/--base64 to util.py, rewrote setup.py deps, added benchmark.py, extended tests/.
  Scrutinise each of these for breakage.
- Does adding __all__ break anything? (e.g. a test doing 'from unidecode import *' then
  using Cache, or 'import unidecode; unidecode.Cache')
- Does the new -b option break the EXISTING argparse behaviour in any way? Run upstream's
  UNMODIFIED tests/test_utility.py from /tmp/gh/unidecode-master against /workspace's
  unidecode package -- do they still all pass? Do the SAME for
  /tmp/uni_dl/Unidecode-1.4.0/tests/test_utility.py (the 1.4.0 variant, which asserts a
  DIFFERENT stderr message format). Report which pass and which fail and why.
- Run upstream's unmodified tests/test_unidecode.py against /workspace. All 66 must pass.
- Spec node 16 asserts unidecode_expect_ascii is measurably FASTER than
  unidecode_expect_nonascii for ASCII input (timeit number=10000). Run that comparison
  20 times and report how reliably the assertion holds. If it is flaky, say so.
- Anything in the spec's 10 numbered requirements that /workspace does NOT satisfy.
Report concrete defects only.`,
  },
]

const audited = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS })
        .then(r => ({ key: d.key, ...(r || { ran: 'AGENT DIED', findings: [] }) })),
  res => parallel((res.findings || []).map(f => () =>
      agent(`${RULES}\n
A previous auditor reported this alleged defect in /workspace. Your job is to REFUTE it.
Default to isReal=false unless you can independently reproduce it yourself and it would
genuinely break a plausible automated test.

TITLE: ${f.title}
FILE: ${f.file}
DETAIL: ${f.detail}
CLAIMED REPRO: ${f.repro}

Independently reproduce it by running code. Consider that the auditor may have:
misread the spec, tested the wrong path, forgotten PYTHONPATH=/workspace, compared
against the wrong baseline, or flagged intentional upstream behaviour as a bug.
Remember: upstream unidecode 1.4.0 IS the reference for correct behaviour, so matching
upstream is never a defect on its own.
If it IS real, give a precise minimal fix.`,
      { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT })
      .then(v => ({ dimension: res.key, ...f, verdict: v }))
  )).then(vs => ({ key: res.key, ran: res.ran, verified: vs.filter(Boolean) }))
)

const rows = audited.filter(Boolean)
const all = rows.flatMap(r => r.verified || [])
const confirmed = all.filter(f => f.verdict && f.verdict.isReal)
const refuted = all.filter(f => f.verdict && !f.verdict.isReal)

log(`audited ${rows.length} dimensions; ${all.length} alleged defects; ${confirmed.length} confirmed, ${refuted.length} refuted`)

phase('Synthesize')

const summary = await agent(`${RULES}\n
Here are the audit results for /workspace (a Unidecode implementation).

Dimensions audited and what each ran:
${rows.map(r => `- ${r.key}: ${r.ran}`).join('\n')}

CONFIRMED defects (survived adversarial verification):
${confirmed.length ? confirmed.map(f => `[${f.severity}] ${f.file} :: ${f.title}\n  ${f.detail}\n  repro: ${f.verdict.correctedRepro || f.repro}\n  fix: ${f.verdict.suggestedFix || 'n/a'}`).join('\n\n') : '(none)'}

REFUTED / dismissed (${refuted.length}): ${refuted.map(f => f.title).join('; ') || '(none)'}

Now do a final independent completeness check yourself, running code against /workspace:
1. PYTHONPATH=/workspace python3 -m pytest /workspace/tests -q  -- report the exact count.
2. Copy upstream's pristine tests from /tmp/gh/unidecode-master/tests to /tmp/final-check/
   and run them against /workspace. Report exact pass/fail counts.
3. Ask yourself: what did NOBODY check? A modality not run, a spec requirement not
   verified, a claim not reproduced? Check the most important one or two of those now.

Then return a plain-text report with two sections:
"MUST FIX" - an ordered list of concrete changes the orchestrator should make to
/workspace, each with the file, the exact edit, and why. Empty list is a valid answer.
"VERIFIED OK" - a terse bullet list of what is confirmed working, with the numbers.
Be blunt and specific. Do not pad.`,
  { label: 'synthesize', phase: 'Synthesize' })

return { confirmedCount: confirmed.length, refutedCount: refuted.length, confirmed, summary }
