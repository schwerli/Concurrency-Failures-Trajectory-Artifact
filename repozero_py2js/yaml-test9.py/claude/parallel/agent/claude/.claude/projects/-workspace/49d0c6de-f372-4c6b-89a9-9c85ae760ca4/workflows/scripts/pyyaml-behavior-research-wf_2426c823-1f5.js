export const meta = {
  name: 'pyyaml-behavior-research',
  description: 'Black-box probe of the PyYAML safe_load+dump executable to produce exact behavioral specs and differential test corpora',
  phases: [
    { title: 'Probe', detail: '5 area experts probe the executable and write specs + case files' },
    { title: 'Critic', detail: 'completeness critics find uncovered behavior per area' },
    { title: 'Fill', detail: 'fill the gaps the critics found' },
  ],
}

const COMMON = `
You are black-box reverse-engineering a compiled Python program so it can be reimplemented in pure JavaScript.

The program is: /workspace/dataset/test9_executable
Its source is exactly:

    import yaml, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()
    result = yaml.dump(yaml.safe_load(args.a), explicit_start=True)
    print(result)

HARD RULES
- NEVER run \`python\`/\`python3\`. Only run the executable. It bundles its own deps.
- You may NOT read PyYAML source (it is not on disk). Everything must come from observed behavior.
- Do not write anything into /output.
- To pass multi-line / tricky values safely, write the value's exact bytes to a file and run:
    node -e 'const{spawnSync}=require("child_process");const fs=require("fs");const a=fs.readFileSync(process.argv[1],"utf8");const r=spawnSync("/workspace/dataset/test9_executable",["--a",a],{encoding:"utf8"});process.stdout.write("RC="+r.status+"\\n---stdout---\\n"+r.stdout+"---end---\\n"+(r.status?r.stderr.split("\\n").slice(-6).join("\\n"):""))' /path/to/case.txt
  Piping the output through \`cat -A\` (or using od -c) is essential for whitespace-exact observation.

DELIVERABLES (both required)
1. A dense, implementation-ready spec at /workspace/dev/spec/<AREA>.md
   - Exact byte-level observations. Tables of input -> exact output. Quote whitespace explicitly (use  markers like <SP>, <TAB>, <NL> where ambiguous).
   - State the inferred RULE behind each observation, and the boundary you probed to pin it down (e.g. "wraps at column 81, verified with 79/80/81/82-char values").
   - Flag anything you could NOT pin down as an OPEN QUESTION with what you tried.
2. Differential test cases: one file per case at /workspace/dev/cases/<AREA>/<nn>-<slug>.txt containing the RAW bytes of the --a value (a trailing newline in the file IS part of the value; omit it if the value has none). Aim for 40-90 well-chosen cases in your area: normal, boundary, and adversarial. These will be replayed against both implementations byte-for-byte, so favor cases that discriminate between plausible implementations.
   Write case files with node/fs (or printf) so the bytes are exact. Verify each case actually runs the way you expect before keeping it. Do NOT keep a case whose observed behavior you did not record in the spec.

Your final message must be a compact summary of the RULES you established (not a list of files) — the most surprising/non-obvious findings first, at most 60 lines. Another engineer will implement from your spec file, but your summary is what the orchestrator reads.
`

const AREAS = [
  {
    key: 'scanner-parser',
    brief: `AREA: YAML input syntax — scanning and parsing (what shapes of input parse, and into what structure).
Cover exhaustively: block mappings and sequences; nested/indentation rules; indentless sequences under a mapping key; flow mappings/sequences ({} [] with nesting, trailing commas, empty entries, missing values like {a: , b}); flow scalars inside flow context; ': ' vs ':' rules (plain scalars containing colons, "a:b" vs "a: b", colon before ] or }); '#' comments (start of line, after value, inside quotes, '#' needing a preceding space); plain scalar termination and multi-line plain scalars (folding, leading/trailing space stripping, empty-line folding); single-quoted scalars ('' escape, multi-line folding); double-quoted scalars (ALL \\ escapes: \\0 \\a \\b \\t \\n \\v \\f \\r \\e \\" \\\\ \\N \\_ \\L \\P \\xXX \\uXXXX \\UXXXXXXXX, \\<newline> line continuation, folding, escaped whitespace at line end, invalid escapes); block scalars | and > with all header combos (|, |-, |+, |2, |-2, |2-, >, >-, >+, > with more-indented lines, leading blank lines, tabs, trailing newlines, chomping semantics); anchors & aliases (&a, *a, on keys, on nested nodes, aliasing a collection so the SAME object is referenced twice, self-referencing/recursive anchors); tags (!!str !!int !!map !!seq !!binary etc, verbatim !<tag>, unknown tag -> error, !local tag -> error?); document markers ('---' with a value on the same line, leading '---', '...' end marker, TWO documents -> what error/exit code, '---' alone, empty input, input that is only comments/whitespace); directives (%YAML 1.1, %YAML 1.2 -> what changes?, %YAML 2.0 -> warning?, %TAG); explicit keys ('? key' / ': value', '?' with a collection key, '? a' with no value); simple-key limits (a very long plain key >1024 chars in flow, a key spanning lines -> error); tabs in various positions; CR / CRLF / \\x85 / U+2028 line breaks in the input; BOM; NUL and other non-printables -> error text.
Record the resulting Python structure indirectly, via the dumped output.`,
  },
  {
    key: 'types',
    brief: `AREA: implicit type resolution + tag construction (which scalars become which Python types, and how each type dumps back).
Cover exhaustively and pin down every boundary: null (empty value, '', '~', 'null', 'Null', 'NULL', 'nUll' -> str?); bool (full accepted set: true/True/TRUE/yes/Yes/YES/on/On/ON/false/False/FALSE/no/No/NO/off/Off/OFF, and rejects: 'y','n','Y','TrUe','ON ','on:'); int (decimal, '+5', '-5', leading zeros '007', underscores '1_0_0', binary '0b1010', '0b1_0', octal '017' vs '0o17', hex '0x1f' '0XFF' '0x_1f', sexagesimal '1:30' '190:20:30' '-1:30' '1:60' '1:5:'; huge ints beyond 2^53 and beyond 2^64 -> exact dumped digits; '0', '-0'); float (with/without leading digits '.5' '5.' '-.5'; exponent forms '1e3' '1.0e3' '1.0e+3' '1e+3' '1.5E-3' — which are floats and which stay strings; '.inf' '-.inf' '.Inf' '.INF' '-.INF' '.nan' '.NaN' '.NAN'; sexagesimal floats '190:20:30.15'; underscores '1_0.5'; '0.0' '-0.0'; 1e16/1e17/1e-5/0.1/1/3.0 round-trip formatting — the exact digits Python prints, including when it switches to exponent form and how the exponent is padded/signed; very long decimals like 0.30000000000000004; 1.7976931348623157e+308; 5e-324); timestamp (date only '2001-12-14', full forms with 'T' or space, fractional seconds of 1..9+ digits, timezones '+5' '-5' '+05:30' 'Z', no timezone, '2001-12-14t21:59:43.10-05:00', invalid dates like '2001-13-45' -> str?, and EXACTLY how each dumps back); str (everything else); and explicit tags: !!null !!bool !!int !!float !!str !!binary !!timestamp !!seq !!map !!set !!omap !!pairs, '<<' merge keys (single map, list of maps, with overrides, merge on a nested key, '<<' with a non-map -> error), '!!value' / '=' key, tag on a collection, tag mismatch errors (e.g. !!int on 'abc', !!bool on 'maybe', !!binary with bad base64/padding/whitespace/newlines).
Also: mapping key semantics — duplicate keys (later wins? which one's position?), keys that are equal across types ('1' vs 1, 1 vs 1.0 vs true, 'yes' vs true), unhashable keys (a list or map used as a key) -> exact error, and how a tuple-ish key (from !!omap/!!pairs) dumps.
For every type, record BOTH the parse result and the exact dumped text.`,
  },
  {
    key: 'emitter-style',
    brief: `AREA: the dumper's scalar style choice + escaping (yaml.dump defaults, explicit_start=True).
Determine, with boundary probes, exactly when a string is emitted plain vs 'single-quoted' vs "double-quoted" vs a block scalar, and how it is escaped/folded. Cover: strings that must be quoted (leading/trailing space, leading indicator chars - ? : , [ ] { } # & * ! | > ' " % @ \` , the string '-' alone, '- ' prefix, ': ' inside, ' #' inside, strings that look like numbers/bools/null/dates such as '5' 'true' 'null' '2001-12-14' '.inf' '' ' ' '~' 'y' 'no', strings with leading/trailing/internal newlines, strings that are only whitespace, strings with \\t, strings with control chars, strings with non-ASCII (allow_unicode is FALSE — verify the escape form used for U+00E9, U+0085, U+00A0, U+2028, U+2029, U+FFFD, U+1F600, lone surrogate-ish inputs), strings with a trailing '\\n' vs several, a string that is exactly 'a\\nb', multi-line strings inside sequences and inside nested mappings (note the continuation indent), a very long single-word string (no space to fold at), a long string with a space right at the fold column, long strings inside deeply-nested structures, long single-quoted and double-quoted strings (how the fold interacts with quoting and with escapes), a long string with a double space, a string with a space before a newline, a string with a tab after a newline.
Also pin down: the exact wrap column and the continuation indent (indent=2), that the fold NEVER splits at a position that would change the value, how leading-space-after-fold cases are avoided, and simple-key handling: when does a key become '? '-prefixed explicit (try keys of 100/128/129/130 chars, multi-line keys, a mapping/sequence as a key, a null key, a long key inside a nested map).
Also: anchors/aliases in output (&id001 numbering across several shared objects, shared object nested at different depths, a recursive structure), collections: empty map/list at root and as a value ('{}' / '[]'), nested empty, sequence-of-sequences indentation, sequence-of-mappings indentation, mapping-of-sequences (indentless!), 4+ levels deep, a mapping whose value is a multi-line string in a sequence in a mapping, and key sorting (sorted ascending for homogeneous keys; mixed-type keys that cannot be compared -> insertion order preserved; ints vs floats vs bools mixed; unicode key ordering; '10' vs '9' string keys vs 10 vs 9 int keys).
Report exact byte output for each.`,
  },
  {
    key: 'cli-and-errors',
    brief: `AREA: command-line argument handling and failure modes.
Pin down exactly (these must be reproduced by a hand-written argv parser):
- The exact usage line and --help output, byte for byte (note the program name shown, and the 'options:' heading).
- Missing --a; '--a' with no value; '--a=value'; '--a=' (empty); '--a' given twice (last wins?); unknown options; extra positional args; '--' separator then a value; '--a --b' (does '--b' get consumed as the value?); values that begin with '-' ('-5', '-5.5', '-x', '-.inf', '--', '-', '- a'); prefix abbreviation ('--a' is the only long option; is '--' alone special?); '-h' and '--help' (also '--help' combined with a missing --a: which wins?); '-a' (single dash) -> error?; empty argv; a value containing '=' or newlines; repeated '-h' after an error.
- The EXACT stderr text and exit code for each failure. Note that usage/error text goes to stderr for errors but stdout for --help.
- The failure mode when the YAML itself is invalid: exit code, and the shape of the stderr traceback (which frames, the final 'yaml.<module>.<Error>: <message>' line, the ' in "<unicode string>", line L, column C:' context block, the source snippet + caret line). Collect ~12 representative invalid inputs (scanner errors, parser errors, composer errors like a duplicate anchor or an undefined alias, constructor errors like an unknown tag/unhashable key/bad !!int, and a two-document input) and record their exact final error message + context block, since the message body is worth reproducing even if the traceback frames are not.
- Whether stdout is flushed before the traceback when an error occurs (i.e. is any stdout produced at all?), and the exact trailing newlines of normal output (print adds one; yaml.dump already ends with one).`,
  },
  {
    key: 'structure-integration',
    brief: `AREA: end-to-end round-trip integration over realistic and adversarial whole documents.
Your job is to produce the broad regression corpus (the other agents cover narrow rules). Build 60-90 cases that look like REAL inputs a test suite would use, plus nasty combinations: k8s/CI/docker-compose-style configs; deeply nested mixes of maps/seqs/scalars; long lists of mixed scalar types; unicode-heavy content; documents mixing quoted and block scalars; multi-line strings in every position; numbers of every flavor in one document; timestamps mixed with strings; anchors/aliases reused across a document; flow collections nested in block collections and vice versa; comments sprinkled everywhere; empty values; documents whose keys need sorting; documents with keys that force explicit '?' keys; values near the 80-column fold; sequences of sequences of sequences; a mapping with 30 keys; strings containing every ASCII punctuation char; content with trailing whitespace on lines.
Record in the spec, for each case, a one-line description plus anything surprising in the output (do NOT paste every full output; paste the outputs that surprised you). Verify every case exits 0 unless you deliberately include a failure case (mark those).
Note: the value of --a is a shell-level string; the 4 sample cases in /workspace/dataset/test9.py show real newlines are passed through, so multi-line documents are in scope and are the common case.`,
  },
]

phase('Probe')
const specs = await parallel(AREAS.map((a) => () =>
  agent(`${COMMON}\n\n${a.brief}\n\nUse AREA = "${a.key}" for your file paths: spec at /workspace/dev/spec/${a.key}.md, cases in /workspace/dev/cases/${a.key}/.`,
    { label: `probe:${a.key}`, phase: 'Probe' })
))

phase('Critic')
const critiques = await parallel(AREAS.map((a, i) => () =>
  agent(`You are a completeness critic for a black-box reverse-engineering effort.

Target program (same rules: NEVER run python; only /workspace/dataset/test9_executable; no PyYAML source available):
    result = yaml.dump(yaml.safe_load(args.a), explicit_start=True); print(result)

Read /workspace/dev/spec/${a.key}.md and list the case files in /workspace/dev/cases/${a.key}/.

Your job: find what is MISSING or WRONG. Specifically hunt for:
- Rules stated in the spec that are actually wrong or over-generalized — verify the interesting ones yourself by running the executable.
- Behaviors in this area that were never probed at all, especially boundaries (off-by-one on widths/lengths/indents), interactions between two features, and inputs a JS implementer would naively get wrong (e.g. UTF-16 surrogate pairs vs code points, integer precision beyond 2^53, float formatting, sort stability, insertion order).
- OPEN QUESTIONS left in the spec that you can actually answer by probing.

The area's original brief was:
${a.brief}

Return a prioritized, concrete list of gaps: each as "GAP: <what> | PROBE: <the exact input to try> | WHY IT MATTERS: <how a JS port would get it wrong>". Include any corrections to the spec with the evidence you observed. Be specific and terse; at most 40 items. Do not edit files.`,
    { label: `critic:${a.key}`, phase: 'Critic' })
))

phase('Fill')
const filled = await parallel(AREAS.map((a, i) => () =>
  agent(`You are extending a black-box behavior spec after a completeness review.

Target program (same rules: NEVER run python; only run /workspace/dataset/test9_executable; no PyYAML source on disk; do not write to /output):
    result = yaml.dump(yaml.safe_load(args.a), explicit_start=True); print(result)

To run a case file's exact bytes:
    node -e 'const{spawnSync}=require("child_process");const fs=require("fs");const a=fs.readFileSync(process.argv[1],"utf8");const r=spawnSync("/workspace/dataset/test9_executable",["--a",a],{encoding:"utf8"});process.stdout.write("RC="+r.status+"\\n---stdout---\\n"+r.stdout+"---end---\\n"+(r.status?r.stderr.split("\\n").slice(-6).join("\\n"):""))' /path/to/case.txt

The existing spec is /workspace/dev/spec/${a.key}.md and its cases are in /workspace/dev/cases/${a.key}/.

A reviewer produced this gap list for your area:
<<<GAPS
${critiques[i] || '(no gaps reported)'}
GAPS

Work through the gap list in priority order: probe each, then UPDATE /workspace/dev/spec/${a.key}.md (correct wrong rules in place; append newly established rules; resolve or restate OPEN QUESTIONS) and ADD a case file per newly probed behavior under /workspace/dev/cases/${a.key}/ (naming: 1nn-<slug>.txt so new cases sort after the originals). Keep every case's bytes exact and verify it runs as expected.

Return a terse summary of what changed: corrections made (with before -> after), new rules established, gaps you could not resolve. At most 50 lines.`,
    { label: `fill:${a.key}`, phase: 'Fill' })
))

return { specs, critiques, filled }
