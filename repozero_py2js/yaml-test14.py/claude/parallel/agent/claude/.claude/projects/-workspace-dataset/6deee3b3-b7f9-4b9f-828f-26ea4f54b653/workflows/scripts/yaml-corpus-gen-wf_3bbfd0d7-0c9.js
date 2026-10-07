export const meta = {
  name: 'yaml-corpus-gen',
  description: 'Generate an exhaustive adversarial YAML input corpus for differential testing of a PyYAML reimplementation',
  phases: [
    { title: 'Generate', detail: 'one agent per YAML feature category writes a case-generator script' },
  ],
}

const CATS = [
  { key: 'scalars-plain', desc: 'Plain (unquoted) scalars: every YAML 1.1 implicit-resolution edge case — ints (decimal, octal 0o and 0NN, hex, binary, sexagesimal like 1:30, underscores), floats (leading dot, trailing dot, exponents with and without explicit sign, sexagesimal floats, .inf/.nan in all casings), bools (yes/no/on/off/true/false/y/n in every casing), nulls (~, null, Null, NULL, empty), strings that ALMOST look like numbers (08, 1e, 1.2.3, +.5, _1, 1:60, 0X1F), and the special "=" value token.' },
  { key: 'scalars-quoted', desc: 'Single-quoted and double-quoted scalars: all escape sequences (\\0 \\a \\b \\t \\n \\v \\f \\r \\e \\" \\\\ \\N \\_ \\L \\P \\x41 \\u0041 \\U00000041 \\<space> \\/), line continuations with backslash, multi-line quoted scalars with folding, doubled single quotes, leading/trailing whitespace, empty quoted strings, strings containing every YAML indicator character, tabs, control chars via escapes, non-ASCII via escapes, and strings long enough (>80 chars, with and without spaces) to exercise line wrapping.' },
  { key: 'block-scalars', desc: 'Block scalars: literal | and folded > with every combination of chomping (-, +, none) and explicit indentation indicators (|2, >3, |2-, >1+), empty content, content that is only blank lines, leading blank lines, more-indented lines, trailing blank lines, tabs inside content, and block scalars as mapping values and sequence items at several nesting depths.' },
  { key: 'collections-block', desc: 'Block collections: nested block mappings and block sequences to depth 6, sequences under mapping keys with and without extra indentation, mappings inside sequence items, explicit key syntax (? / :), empty keys, empty values, null values, keys longer than 128 characters (which force the "?" explicit-key form), duplicate keys, and mixed nesting.' },
  { key: 'collections-flow', desc: 'Flow collections: [] and {} nested arbitrarily, flow inside block and block inside flow contexts, trailing commas, empty flow collections, flow entries with missing values ({a}), flow pairs ([a: b]), single-pair mappings inside sequences, adjacent-value syntax, and deeply nested flow.' },
  { key: 'tags-anchors', desc: 'Explicit tags and anchors/aliases: !!str !!int !!float !!bool !!null !!binary !!timestamp !!set !!omap !!pairs !!seq !!map applied to compatible AND incompatible node kinds, verbatim tags !<tag:x>, unknown local tags !foo, %TAG directives with named handles, anchors reused 2-3 times, anchors on scalars vs collections, recursive anchors (&a [*a]), aliases inside flow collections, and anchors combined with tags.' },
  { key: 'merge-keys', desc: 'Merge key << behaviour: merging a single mapping, merging a list of mappings (order matters), merge combined with locally-overridden keys, nested merges (a merged mapping that itself contains a merge), merges inside flow mappings, merges at various positions in the mapping, aliases pointing at mappings used as merge sources, and invalid merge values.' },
  { key: 'timestamps-binary', desc: 'Timestamps and binary: dates YYYY-MM-DD, canonical datetimes with T and with space, fractional seconds of 1..9 digits (rounding at 7+ digits), timezone Z, +HH:MM, -HH:MM, +H, spaces before the timezone, dates that do NOT match the implicit resolver (2001-1-1), invalid dates (2001-02-30), explicit !!timestamp tags on quoted strings, and !!binary with valid base64, base64 with embedded whitespace/newlines, empty base64, and base64 long enough to wrap at 76 columns.' },
  { key: 'dict-key-types', desc: 'Mapping key types and PyYAML key sorting: all-string keys needing lexicographic sort (including uppercase/lowercase/underscore/dash/digits), all-integer keys, all-float keys, mixed int and float keys, boolean keys, null keys, timestamp keys, binary keys, keys that collide under Python equality (1 vs 1.0 vs true), and MIXED incomparable key types (str + int, str + null, date + datetime) which make Python\'s sorted() raise TypeError so insertion order is preserved. Include mappings with 1, 2, 3, 5, 10 and 70 keys.' },
  { key: 'documents-directives', desc: 'Document structure: implicit documents, explicit --- start, ... end markers, %YAML directives (1.1, 1.2, and incompatible 2.0), %TAG directives, leading/trailing blank lines, comments in every position (own line, end of line, between key and value, before and after documents), documents that are just comments, empty input, whitespace-only input, and multi-document input (which must error).' },
  { key: 'errors-malformed', desc: 'Malformed YAML that must raise: unclosed flow collections, unclosed quotes, bad escape sequences, tabs used as indentation or separation, undefined aliases, mapping values not allowed here, block sequence entries at wrong indentation, unhashable keys ([a] as a key), a second document in the stream, invalid tag handles, incompatible YAML version, invalid base64, !!int on non-numeric text, !!bool on non-boolean text, and non-printable control characters in the raw input.' },
  { key: 'unicode-whitespace', desc: 'Unicode and whitespace: non-ASCII text (accented Latin, CJK, Cyrillic, Greek), astral-plane characters (emoji, U+10000 and above), BOM at the start of the stream and in the middle of a scalar, NEL U+0085, LS U+2028, PS U+2029 as line breaks and inside scalars, non-breaking space U+00A0, strings with only spaces, strings with leading/trailing spaces, and strings with internal runs of spaces and newlines in every combination (space-then-break, break-then-space).' },
  { key: 'realistic-configs', desc: 'Realistic YAML documents of the kind a test suite would contain: Kubernetes-style manifests, CI pipeline configs, docker-compose files, application settings with nested maps and lists, inventory/host lists, i18n message catalogs, package manifests with version strings, feature-flag maps of booleans, matrix/build definitions using anchors and merges, and small data records mixing strings, numbers, dates and nulls. Keep each under 25 lines.' },
  { key: 'emitter-stress', desc: 'Inputs designed to stress the OUTPUT emitter rather than the parser: values that must be emitted double-quoted (trailing spaces, tabs, control characters, non-ASCII, BOM, leading-space-then-break combinations), values whose block-scalar hints differ (|, |-, |+, |2, |2-, |2+), values that end with one, two or three newlines, values that are a single newline, mapping keys long enough to break the 128-character simple-key limit, double-quoted scalars long enough to wrap at 80 columns with and without spaces to break on, and deeply indented block scalars.' },
];

phase('Generate')

const results = await parallel(CATS.map((cat, i) => () => agent(
`You are building a differential-test corpus for a byte-exact JavaScript reimplementation of this Python program:

    import yaml, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=str, required=True)
    args = parser.parse_args()
    print(yaml.dump(yaml.safe_load(args.a), default_style='|'))

Your assigned category is "${cat.key}":
${cat.desc}

TASK: write a Node ESM script at /workspace/probe/corpus/gen_${cat.key}.mjs that writes AT LEAST 60 distinct test-case files into /workspace/probe/corpus/${cat.key}/ named 001.txt, 002.txt, ... Each file's ENTIRE byte content is one value for the --a argument (a YAML document, possibly multi-line, possibly with a trailing newline).

Rules:
- Use only: import { writeFileSync, mkdirSync } from 'node:fs'
- Build the cases as a plain JS array of strings, then write them out. Use \\n, \\t, \\u.... escapes in the JS source rather than literal control characters.
- Cases must be DISTINCT from one another and must actually exercise your category. Prefer many small focused cases over a few large ones. Include obvious/common forms as well as pathological ones.
- Do NOT include a case whose text starts with "-" unless it also contains a space before any newline (argparse would swallow it as an option flag). Concretely: if the string starts with "-", make sure the FIRST line contains a space, e.g. "- a" is fine, "---" alone is not.
- Some cases SHOULD be invalid YAML if your category calls for it; that is expected and useful.
- Avoid the NUL character.

Then RUN your script with: cd /workspace/probe/corpus && node gen_${cat.key}.mjs
Then sanity-check that the files exist and a few of them produce sensible behaviour from the reference binary, e.g.:
    /workspace/dataset/test14_executable --a "$(cat /workspace/probe/corpus/${cat.key}/001.txt)"
(that shell form mangles trailing newlines, it is only a smoke test).

Do not modify anything outside /workspace/probe/corpus/. Do not read or write /output.

Return ONLY a one-line summary: the category key and the number of case files written.`,
  { label: `corpus:${cat.key}`, phase: 'Generate' }
)))

return results.filter(Boolean)
