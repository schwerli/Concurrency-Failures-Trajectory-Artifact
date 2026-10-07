export const meta = {
  name: 'deepdiff-py2node-spec',
  description: 'Black-box probe the DeepDiff Python executable across 6 behavioural dimensions and produce an exact implementation spec',
  phases: [
    { title: 'Probe', detail: 'six parallel probers derive exact specs from the executable' },
    { title: 'Critique', detail: 'completeness critic hunts for unprobed behaviour' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    spec: { type: 'string', description: 'Precise, implementable spec in markdown. Include exact algorithms, pseudocode, and every observed input->output pair that pins down a rule.' },
    evidence: {
      type: 'array',
      description: 'Concrete probe results that justify the spec',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          output: { type: 'string' },
          rule: { type: 'string' },
        },
        required: ['input', 'output', 'rule'],
      },
    },
    gotchas: { type: 'array', items: { type: 'string' }, description: 'Traps a JS implementer would fall into' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['dimension', 'spec', 'evidence', 'gotchas', 'openQuestions'],
}

const COMMON = `
You are reverse-engineering a pre-compiled Python program as a BLACK BOX so it can be reimplemented in pure Node.js.

The Python source is exactly:
    import argparse
    from deepdiff import DeepDiff
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    args = parser.parse_args()
    result = DeepDiff(args.a, args.b)
    print(result)

The compiled executable is /workspace/dataset/test1_executable (PyInstaller bundle, ~1s startup).

RULES:
- Probe it by RUNNING it. Do NOT try to read/extract the bundled Python sources of deepdiff/difflib/argparse. Derive rules from observed behaviour (your knowledge of CPython semantics is fine for forming hypotheses, but every rule you state must be CONFIRMED by an actual run).
- Drive it from Node. A helper exists at /workspace/probe/drv.mjs exporting run(a,b), raw(argvArray), reprOf(s). Import it with a relative path.
- IMPORTANT: create probe scripts with the Write tool, NOT with bash heredocs. Bash commands containing literal control characters are rejected by the sandbox. Inside JS source use escapes like "\\u0007", "\\n", "\\u2028".
- Put your scripts in /workspace/probe/ . Batch many cases per node invocation (each executable launch costs ~1s, so loop inside one node process, and prefer many cases per process over many processes).
- Never run the 'python' command on the code under test. Node is your only driver.

ALREADY-ESTABLISHED FACTS (do not re-derive, but do not contradict without strong evidence):
- Equal strings print exactly "{}" + newline.
- Different strings print: {'values_changed': {'root': {'new_value': <repr b>, 'old_value': <repr a>}}}
  with new_value BEFORE old_value, and an optional third key 'diff' AFTER old_value.
- The 'diff' key appears only when '\\n' occurs in a or b AND the unified diff of their splitlines() is non-empty.
  ('a\\n' vs 'a' -> no diff key, because splitlines() are both ['a'].)
- '\\n' vs '' yields diff '--- \\n+++ \\n@@ -1 +0,0 @@\\n-' (4 lines), so the gate is "non-empty diff", not "len > 4".
- \\r, \\v, \\f, \\x1c, \\x85, \\u2028 alone do NOT trigger the diff key. Only \\n does.
`

const DIMENSIONS = [
  {
    key: 'repr-quoting',
    label: 'probe:repr-quoting-escapes',
    prompt: `${COMMON}

YOUR DIMENSION: the exact rendering of a Python str inside the printed dict — i.e. Python's str.__repr__ — for QUOTING and ESCAPE SYNTAX.

Determine and confirm empirically:
1. Quote character selection. When is the value wrapped in ' vs "? Probe: no quotes, only ', only ", both ' and ", strings ending/starting with quotes.
2. Which characters get backslash-escaped, and in what form. Probe at minimum: backslash, the active quote char, the inactive quote char, \\u0000, \\u0007 (bell), \\u0008 (backspace), \\u0009 (tab), \\u000a, \\u000b, \\u000c, \\u000d, \\u001b (esc), \\u001f, \\u007f, \\u0080, \\u00a0, \\u00ad, \\u009f, \\u00ff.
   Establish precisely: does Python repr emit \\a \\b \\v \\f, or the \\xHH numeric form? Which of \\t \\n \\r ARE special-cased?
3. The numeric escape width rule: when is \\xHH used vs \\uHHHH vs \\UHHHHHHHH? Find the exact code-point boundaries by probing around 0xFF/0x100 and 0xFFFF/0x10000.
4. Hex digit case (lowercase vs uppercase) and zero padding.
5. Astral-plane characters (e.g. U+1F600 emoji, U+10FFFF). Are they emitted literally or escaped? Does the answer depend on their Unicode category? NOTE: JS strings are UTF-16 so astral chars are surrogate PAIRS in JS -- state clearly how a JS implementation must iterate (code points, not code units).
6. Whether escaping differs between the 'new_value' and 'old_value' positions (it should not -- confirm).

Write the spec as a directly implementable function pythonStrRepr(s) in pseudocode, covering the loop order and every branch. Be exhaustive about the branch ORDER (e.g. is backslash checked before the quote char?).`,
  },
  {
    key: 'printability',
    label: 'probe:unicode-printability',
    prompt: `${COMMON}

YOUR DIMENSION: exactly WHICH code points Python's repr escapes because they are "not printable", and how to reproduce that set in Node without any external dependency.

Hypothesis to test hard: Python escapes a character iff it is not str.isprintable(), i.e. iff its Unicode General_Category is one of Cc, Cf, Cs, Co, Cn, Zs, Zl, Zp -- EXCEPT that ASCII space U+0020 is printable and emitted literally.

Node 18 supports Unicode property escapes: /[\\p{C}\\p{Z}]/u , and individual ones like \\p{Cc} \\p{Cf} \\p{Co} \\p{Cn} \\p{Zs} \\p{Zl} \\p{Zp}. Note \\p{C} = Cc+Cf+Co+Cs+Cn and \\p{Z} = Zs+Zl+Zp.

Do this:
1. Build a Node predicate jsPred(cp) = (cp === 0x20) ? true : !/[\\p{C}\\p{Z}]/u.test(String.fromCodePoint(cp)).
2. Empirically compare it against the executable over a LARGE sample of code points. Efficiency trick: you can put MANY code points in ONE argument and read which ones came back escaped in the repr, so one executable run can classify hundreds of code points. Use a separator you know is printable (e.g. '.') between them so you can align the output. Watch out: some code points may be dropped/altered by the OS argv path -- validate your alignment method first on a known-good batch.
3. Cover systematically: all of U+0000..U+0FFF, then dense sampling of the rest of the BMP (especially U+2000-U+206F separators/format chars, U+FE00-U+FEFF, U+FFF0-U+FFFF), plus astral samples (U+1F600, U+E0001, U+F0000 (Co), U+10FFFF (Cn)).
4. Report EVERY code point where jsPred disagrees with the executable. Disagreements are expected only for Cn (unassigned) code points if Node's Unicode version differs from the Python build's. List them exactly, and say whether the count is small enough to hardcode as a fixup table (give the table if so).
5. Determine what happens to code points that CANNOT survive the command line at all (U+0000 in particular, since argv is NUL-terminated). State what the JS version should do -- can it even receive them?

Deliver: the exact Node predicate to use, plus any fixup table, plus the list of confirmed disagreements.`,
  },
  {
    key: 'splitlines',
    label: 'probe:splitlines-and-diff-gate',
    prompt: `${COMMON}

YOUR DIMENSION: (a) the exact line-splitting used for the 'diff' value, and (b) the exact gate that decides whether the 'diff' key appears at all.

1. Python's str.splitlines() splits on MORE boundaries than '\\n'. Candidate boundaries: \\n (000a), \\r (000d), \\r\\n, \\v (000b), \\f (000c), \\x1c, \\x1d, \\x1e, \\x85 (NEL), \\u2028 (LS), \\u2029 (PS). Confirm empirically WHICH of these act as line boundaries when producing the diff. Do it by putting a candidate boundary in a string that ALSO contains a '\\n' (so the diff key is triggered) and observing whether the diff treats the candidate as a line break.
   Example probe: a = 'x\\u2028y\\nz', b = 'x\\u2028y\\nQ'. If \\u2028 splits, the diff shows separate lines for x and y.
2. Confirm that splitlines() does NOT keep the line terminators, and confirm the trailing-newline behaviour ('a\\n'.splitlines() == ['a'], 'a\\n\\n' == ['a','']).
3. Confirm the diff GATE precisely. Test: strings that differ only by a trailing '\\n'; strings that differ only by a \\r; strings containing \\u2028 but no \\n where the \\u2028-split lines differ (does the diff key appear? -- this pins down whether the gate literally tests for the '\\n' character or for "more than one line").
   Critical case: a = 'x\\u2028y', b = 'x\\u2028z' -- multiline under splitlines() but contains no \\n.
   Critical case: a = 'a\\rb', b = 'a\\rc' -- confirmed no diff key. Explain consistently.
4. Determine whether the strings are compared for equality BEFORE or AFTER any normalisation (is 'a' vs 'a' always {}? is there any case where two DIFFERENT strings produce {}?). Try hard to find a false-{} case.
5. State the exact JS splitLines(s) implementation, including how astral/BMP boundary chars are handled and \\r\\n treated as ONE boundary.`,
  },
  {
    key: 'unified-diff',
    label: 'probe:unified-diff-algorithm',
    prompt: `${COMMON}

YOUR DIMENSION: the exact unified-diff text produced in the 'diff' value. This must match difflib.unified_diff(a.splitlines(), b.splitlines(), lineterm='') joined by '\\n', character for character.

Establish and CONFIRM by probing:
1. Header format. Confirmed so far: first two lines are exactly "--- " and "+++ " (with ONE trailing space, no filename, no date). Verify there is no trailing tab.
2. Hunk header format: "@@ -<start>,<len> +<start>,<len> @@". Determine the exact rule for when the ",<len>" part is OMITTED (observed: "@@ -1 +1,2 @@" and "@@ -1 +0,0 @@"). Pin down the rule for length==1 and for length==0, and what <start> is when length==0 (observed +0,0). Probe deletions at the start of the file and empty-side hunks.
3. Context: the number of context lines around each change (expected 3) -- confirm by building inputs with changes separated by 1..10 identical lines and observing when ONE hunk splits into TWO. This is the single most important thing to get exactly right.
4. Line prefixes: ' ' for context, '-' for removed, '+' for added. Confirm a context line that is itself empty renders as a single space? or as an empty line? (Probe with blank lines in the middle.) Confirm a removed empty line renders as just "-".
5. The core matching algorithm is difflib.SequenceMatcher over LINES. Its opcode output is NOT the same as a minimal edit script -- it is a recursive longest-matching-block algorithm, and it has an "autojunk" heuristic that treats any element appearing in more than 1% of a sequence of length >= 200 as junk. Design probes that distinguish it from a naive LCS/Myers diff:
   - inputs where a naive LCS and difflib pick DIFFERENT alignments (e.g. repeated lines: a = 'a,b,a,b,c' vs b = 'a,b,c' style, and cases with a moved block);
   - inputs of >= 200 lines where one line repeats > 1% of the time (autojunk should kick in and change the alignment vs. small inputs);
   - report whether autojunk is observable here.
   Report your probe inputs and the exact outputs so the implementer can regression-test against them.
6. Describe SequenceMatcher precisely enough to reimplement: find_longest_match with the b2j index, the popular/junk exclusion, the tie-break rule (earliest i, then earliest j, then longest), the recursive get_matching_blocks, and get_opcodes. Also describe the ADJACENT-EQUAL-BLOCK MERGE step in get_matching_blocks.
7. Determine whether the diff value is ever truncated or size-limited for very large inputs (test ~2000 lines).

Deliver: implementable pseudocode plus at least 8 concrete (a, b) -> exact diff string regression pairs, chosen to be maximally discriminating. Report each regression pair's expected output as the LITERAL characters (use \\n notation).`,
  },
  {
    key: 'argparse',
    label: 'probe:argparse-cli',
    prompt: `${COMMON}

YOUR DIMENSION: the complete command-line-parsing behaviour, which must be replicated exactly (stdout, stderr, exit code).

The program name in messages is derived from the executable basename. NOTE for the implementer: the Node version will be run as "node test1.mjs", so decide and state what prog name it should print -- test the executable to learn the exact message TEMPLATES, and state them with a placeholder for prog.

Probe and record EXACT bytes (stdout vs stderr, and exit code) for:
1. Success: --a X --b Y ; --a=X --b=Y ; --b Y --a X ; mixed forms.
2. Missing one or both required args. Exact "usage:" line, exact error line, exit code, and WHICH stream each goes to. Note the order args are listed in the error.
3. Unrecognized args: extra --c X ; extra positional Z ; both.
4. -h and --help: full exact text including blank lines and indentation. Also test 'options:' vs 'optional arguments:' heading (Python version dependent) -- record verbatim. Exit code.
5. Abbreviations / prefix matching: since the options are --a and --b, is there any prefix that is ambiguous? Test single-dash forms: -a X, -b Y (do they work? argparse with a long option '--a' -- does '-a' match?). Test --a with no value. Test '--' separator: --a X --b Y -- ; -- --a X.
6. Values that look like options: --a --b (does --b get consumed as the value of --a?). --a -x . --a=-x . --a "" . --a=-- . --a "-1" (argparse has special negative-number handling -- test whether -1 is treated as a value or an unknown option).
7. Repeated args: --a X --a Y (last wins?). 
8. Empty string values, values with spaces, values with leading/trailing spaces, values starting with '='.
9. Whether stdout ends with exactly one '\\n' on success.
10. Any interspersed/greedy behaviour: --a X Y (extra positional after a value).

Deliver: a complete decision-procedure spec for a hand-written parser, plus a table of (argv -> stdout, stderr, exit code) regression cases. Give message templates with the prog name as a placeholder and say exactly how many spaces are in each.`,
  },
  {
    key: 'container-repr',
    label: 'probe:output-container-format',
    prompt: `${COMMON}

YOUR DIMENSION: the formatting of the OUTER printed structure (the dict repr), and any DeepDiff-level behaviour beyond the string repr itself.

Probe and confirm:
1. The exact literal skeleton, character by character, including every space and brace:
   {'values_changed': {'root': {'new_value': ..., 'old_value': ..., 'diff': ...}}}
   Confirm: is there a space after each colon? after each comma? Are the KEY names themselves single-quoted? Is there a trailing comma anywhere?
2. Key insertion order in the innermost dict, with and without 'diff'. Confirm new_value comes first.
3. The path string: always exactly 'root' for two scalars? Confirm with many inputs.
4. Whether the 'diff' value is rendered with the SAME python-str-repr rules as new_value/old_value (it contains newlines -- confirm they appear as the two-character escape \\n inside a single-quoted string, not as real newlines). Confirm what happens when the diff text itself contains a single quote (feed input lines containing apostrophes) -- does the quoting of the diff value switch to double quotes independently of the other two values?
5. The empty case: exactly "{}" -- confirm no spaces.
6. Confirm print() adds exactly one trailing newline and nothing else (check for trailing spaces / \\r). Use a byte-level check (e.g. hexdump the output, or check the JS string).
7. Try to find ANY input pair where the top-level key is NOT 'values_changed' (e.g. 'type_changes'). Both args are always str, so this should be impossible -- confirm, and note if anything surprising appears (e.g. very long strings, strings that look like numbers, 'True'/'None'/'1e5'/'nan'/'inf' -- does DeepDiff coerce or sniff types? test these specifically).
8. Test strings that look like numbers with different precision ('1.0' vs '1.00', '1e5' vs '100000') to be sure no numeric coercion happens.

Deliver the exact output template plus the confirmed no-coercion result.`,
  },
]

phase('Probe')

const specs = await parallel(DIMENSIONS.map((d) => () =>
  agent(d.prompt, { label: d.label, phase: 'Probe', schema: SPEC_SCHEMA })
))

const good = specs.filter(Boolean)
log(`collected ${good.length}/${DIMENSIONS.length} dimension specs`)

phase('Critique')

const digest = good.map((s) => `## ${s.dimension}\n${s.spec}\n\nGOTCHAS:\n${(s.gotchas || []).map((g) => '- ' + g).join('\n')}\n\nOPEN:\n${(s.openQuestions || []).map((q) => '- ' + q).join('\n')}`).join('\n\n---\n\n')

const critique = await agent(`${COMMON}

Six probers have produced the spec digest below for reimplementing this program in Node.js.

Your job: be the COMPLETENESS CRITIC. Find what is still unknown or wrong. Then RESOLVE it yourself by running more probes against the executable.

Focus on:
- Any rule stated without confirming evidence, or any open question left unanswered. Answer them by probing.
- Interactions BETWEEN dimensions that no single prober would have tested. Especially:
  (a) a multiline string whose lines contain single quotes AND double quotes -- how is the 'diff' value quoted?
  (b) a multiline string containing non-printable chars -- are they escaped inside the diff value too, and does the escaped backslash-n of the diff joiner get double-escaped?
  (c) astral-plane characters inside a multiline diff (JS UTF-16 vs Python code points) -- line splitting and repr together.
  (d) \\r\\n line endings combined with the 3-line context rule.
  (e) whether a lone \\r inside a line that is part of a triggered diff gets split (splitlines says yes) -- and how that interacts with the diff gate testing for \\n.
  (f) argv edge: an argument containing invalid UTF-8 bytes. Python decodes argv with surrogateescape, producing lone surrogates whose repr is like '\\udcff'. Node's process.argv would give U+FFFD instead. CONFIRM what the executable prints for an argument with raw byte 0xFF, and report whether reading /proc/self/cmdline in Node could recover the raw bytes (describe the approach; note process.argv.length-2 gives the user-arg count).
- Anything a JS implementer would get wrong that nobody flagged.

Report a list of ADDITIONAL confirmed rules with evidence, and corrections to the digest. Be concrete and literal about expected output strings.

=== SPEC DIGEST ===
${digest}
`, { label: 'critique:completeness', phase: 'Critique' })

return { specs: good, critique }
