export const meta = {
  name: 'md-spec-probe',
  description: 'Probe the Python-Markdown executable in parallel to produce precise behavioral specs per feature area',
  phases: [
    { title: 'Probe', detail: 'one agent per markdown feature area, writes /workspace/spec/*.md' },
    { title: 'Critic', detail: 'completeness critic finds unprobed corners' },
  ],
}

const BT = String.fromCharCode(96)
const BS = String.fromCharCode(92)

const AREAS = [
  { key: 'argparse', title: 'argparse CLI semantics',
    detail: 'Exhaustively probe the CLI argument parsing ONLY (not markdown). Cover: exact --a/--b, --a=value, long-option abbreviation (does --a work, what about ambiguous prefixes, what about --aa), single-dash forms, -h and --help exact output text and exit code, missing required args, unrecognized args, error message precedence when several errors apply at once, the bare -- separator, values that start with a dash (negative numbers like -1, -1.5, -.5, -1e5, values with spaces like "- 1", and "-x"), repeated options (last wins), empty string values, values containing "=", option-like values after "=", interspersed ordering (--b before --a), exit codes, and whether errors go to stdout or stderr. Record the EXACT usage and error strings byte for byte. NOTE: probe.mjs only varies --a, so for this area drive the executable directly with node child_process spawnSync (argv arrays, never bash quoting).' },
  { key: 'paragraph-basics', title: 'paragraphs, headers, hr, br, whitespace normalization',
    detail: 'Probe: paragraph splitting on blank lines, lines containing only spaces or tabs, ATX headers (one through six hashes, more than six, closing hashes, no space after the hash, empty header, trailing whitespace), setext headers (equals and dashes underlines, single char, trailing spaces), horizontal rules (three dashes, three asterisks, three underscores, spaced forms, more than three chars, fewer than three, trailing spaces, hr versus setext ambiguity, hr versus list-item ambiguity), line breaks (two or more trailing spaces produce a break element, single trailing space, trailing tab, backslash at end of line), tab expansion (how many spaces does a leading tab become), carriage-return line endings (CRLF and lone CR), leading and trailing blank lines, form feed, vertical tab, and unicode whitespace. Also probe what a lone hash or a lone greater-than sign produces.' },
  { key: 'lists', title: 'ordered/unordered lists and nesting',
    detail: 'Probe deeply: bullet markers (asterisk, plus, hyphen), ordered markers ("1." and "1)" - is the paren form supported?), the start attribute when a list does not begin at 1, loose versus tight lists (blank line between items causing paragraph wrapping), nested lists at 2/3/4/5/6/8 spaces of indent, mixing marker types (does a new list start?), a list item containing multiple paragraphs, a list item containing an indented code block, a list item containing a blockquote, an ordered list nested inside a bullet list, lazy continuation lines, a list interrupting a paragraph, items with no content, items with only whitespace, indent handling with tabs, and the exact placement of newlines in the emitted HTML.' },
  { key: 'blockquote-code', title: 'blockquotes and indented code blocks',
    detail: 'Probe: quote marker with and without a following space, nested quotes, lazy continuation, blank line inside a quote, a quote containing a list/header/code block/hr, a quote immediately after a paragraph, an escaped quote marker. Indented code blocks: exactly 4 spaces, 5 or more spaces (is the extra indent preserved?), tabs, blank lines inside a code block, trailing blank lines, a code block at document start versus after a paragraph, HTML escaping inside code (ampersand, angle brackets, quotes, apostrophe), a code block directly after a list, and the exact trailing newline inside the pre/code element.' },
  { key: 'inline-emphasis', title: 'emphasis, strong, and the em_strong patterns',
    detail: 'Probe exhaustively with both asterisk and underscore forms: single-marker emphasis, double-marker strong, triple-marker both, mixed nesting, intraword underscores (snake_case_word, a_b_c), intraword asterisks (a*b*c), unmatched markers, escaped markers, four or more markers, emphasis spanning a newline, emphasis with adjacent punctuation, empty marker runs, a line that could be a list item versus emphasis, nested emphasis, and emphasis around and inside links and code spans. Report the exact HTML for each.' },
  { key: 'inline-code-escape', title: 'code spans, backslash escapes, entities, raw inline HTML',
    detail: 'Probe: code spans delimited by one, two, and three backticks; unbalanced delimiters; a code span containing backticks; leading and trailing spaces inside a code span; HTML escaping inside code spans (ampersand, angle brackets, double quote, apostrophe). Backslash escapes: determine EXACTLY which characters are escapable and which are left literal - test a backslash before each of these characters: backslash, backtick, asterisk, underscore, brace open, brace close, bracket open, bracket close, paren open, paren close, hash, plus, hyphen, dot, bang, angle brackets, pipe, colon, quote, letter, digit, space, and end of line. HTML entities: named, decimal numeric, hex numeric, unknown named, malformed numeric, bare ampersand, ampersand followed by text, bare angle brackets. Inline raw HTML: simple tags, void tags with and without a slash, unclosed tags, attributes in single and double quotes, an attribute value containing an angle bracket, HTML comments inline, and processing instructions.' },
  { key: 'links-images', title: 'links, images, references, autolinks',
    detail: 'Probe: inline links, titles in double quotes, single quotes, and parens, empty url, url containing spaces, url wrapped in angle brackets, nested brackets in the link text, images with alt and title, reference links in full/collapsed/shortcut forms, case-insensitive reference ids, reference definitions (title on the same line and on the next line, indented definitions, multiple definitions, a definition that is never used), missing references, image references, autolinks for http and mailto, bare email autolink (Python-Markdown obfuscates the address with character entities - capture the EXACT obfuscation, and note whether it is deterministic across runs), angle brackets containing non-URL content, urls containing parentheses, urls containing underscores and asterisks, and the exact ATTRIBUTE ORDER in the emitted tags.' },
  { key: 'fenced-code', title: 'fenced_code extension',
    detail: 'Probe both tilde fences and the three-backtick fences (build these strings in a JSON case file, not in bash): three versus four or more fence chars, the rules for what closes a fence, an info string naming a language, brace forms like {.python} and {: .cls #id}, the exact emitted class attribute, fences with no info string, fences inside list items and blockquotes, indented fences, an unclosed fence, nested fences, blank lines inside a fence, HTML escaping inside a fence, trailing spaces after the info string, and the exact newline placement in the output.' },
  { key: 'tables', title: 'tables extension',
    detail: 'Probe: a basic table, alignment delimiter rows (left, right, center, none), missing leading and trailing pipes, ragged rows with fewer and more cells than the header, escaped pipes, pipes inside code spans, pipes inside link urls, empty cells, a table with only a header row, the exact requirements for the delimiter row (minimum dashes, spaces allowed, alignment colons), a table interrupting a paragraph, a table inside a list item or blockquote, inline markdown inside cells, the exact style attribute format for alignment, and all whitespace and newlines in the emitted HTML.' },
  { key: 'deflist-abbr', title: 'def_list and abbr extensions',
    detail: 'def_list: a single term and definition, multiple definitions for one term, multiple terms sharing a definition, definition markers (colon and tilde), indented continuation lines, loose definitions (blank line causing paragraph wrapping inside the dd), a definition containing multiple paragraphs, a code block, or a list, a term containing inline markdown, and spacing variants after the marker. abbr: the definition syntax with a bracketed abbreviation, case sensitivity of matching, abbreviations appearing inside code spans or headers, multi-word abbreviations, an abbreviation defined after its use, duplicate definitions, abbreviations containing special characters, an empty definition, whether the definition block is removed from the output, and whether matching respects word boundaries.' },
  { key: 'footnotes', title: 'footnotes extension',
    detail: 'Probe exhaustively and capture EXACT html: numeric and named footnote references, multiple references to the same footnote (how do the backref anchors and their ids/counters change?), definitions with multiple paragraphs, indented continuation, definitions containing lists, code blocks, or blockquotes, undefined references, footnotes defined but never used, the ORDERING of the footnote list (definition order versus reference order), the exact div/hr/ol/li structure, the id and href formats, the class names, the numeric character entities used for the separator and the backref glyph, the backref title attribute text, footnotes combined with other block types, and duplicate definitions of the same id.' },
  { key: 'attr-list', title: 'attr_list extension',
    detail: 'Probe: an attr list with a class, with an id, with and without the leading colon, multiple classes, key=value pairs, quoted values containing spaces, bare words, attr lists on headers, on paragraphs, on list items, on table cells, on fenced code blocks, inline attr lists attached to emphasis, links, code spans, and images, the ATTRIBUTE ORDER in the output, duplicate keys, class accumulation when the element already has a class, an empty attr list, malformed attr lists, and an attr list on the last line versus the first line of a multi-line paragraph.' },
  { key: 'md-in-html', title: 'md_in_html extension and raw HTML block handling',
    detail: 'Probe: raw HTML blocks passed through verbatim, block-level versus inline tags at the start of a block, the markdown attribute with values 1, block, and span, nested markdown attributes, raw HTML containing blank lines, unclosed tags, self-closing tags, script and style contents, HTML comments as blocks, CDATA, doctype declarations, processing instructions, an opening tag whose attributes span several lines, indented HTML blocks, HTML immediately followed by text on the next line, text immediately followed by HTML, a paragraph tag containing markdown, void elements, tag name case sensitivity, and how raw HTML interacts with paragraph wrapping. Capture exact whitespace and newlines.' },
  { key: 'interactions', title: 'cross-feature interactions and pathological inputs',
    detail: 'Probe combinations: a table inside a blockquote inside a list; a fenced code block inside a definition list; a footnote reference inside a table cell; an attr list on a table; an abbreviation inside a footnote; a reference definition inside a list; an HTML block inside a list item; deeply nested structures; very long lines; CJK text (the real test cases are Chinese) including CJK punctuation adjacent to emphasis markers; emoji and astral-plane characters (surrogate pairs) adjacent to emphasis markers; combining characters; right-to-left text; control characters; unicode line and paragraph separators U+2028 and U+2029; non-breaking and other exotic spaces; zero-width characters; and inputs consisting only of whitespace or only of markers. Report anything surprising.' },
]

phase('Probe')

const SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    specPath: { type: 'string' },
    probeCount: { type: 'number' },
    keyFindings: { type: 'array', items: { type: 'string' } },
    surprises: { type: 'array', items: { type: 'string' } },
    corpusPath: { type: 'string' },
    corpusCases: { type: 'number' },
  },
  required: ['area', 'specPath', 'probeCount', 'keyFindings', 'corpusPath', 'corpusCases'],
}

function probePrompt(a) {
  return [
    'You are reverse-engineering a precompiled Python program so it can be reimplemented in JavaScript.',
    '',
    'The program is /workspace/dataset/test2_executable. It takes two required options --a and --b, and prints the result of Python-Markdown 3.x rendering of --a with the "extra" extension bundle enabled, followed by a newline. Only --a affects the rendered output; --b is required but ignored.',
    '',
    'Helper you MUST use to see exact bytes:',
    '  cd /workspace/harness && node probe.mjs -f /tmp/' + a.key + '-batch1.json',
    'where the file is a JSON array of markdown source strings. It prints the JSON-escaped input, the JSON-escaped output (so whitespace is unambiguous), and the raw output. Always use the -f form: write the JSON case files with the Write tool or a small node script so quoting, newlines and backslashes are exact. Do NOT fight bash quoting.',
    'A single-shot form also exists: node probe.mjs ' + BT + 'source' + BT + ' but prefer -f.',
    '',
    'YOUR AREA: ' + a.title,
    '',
    a.detail,
    '',
    'Method:',
    '- Probe in large batches (30 to 80 inputs per command is efficient). Iterate: form a hypothesis, then probe the boundary cases that would FALSIFY it, then refine.',
    '- Never state a rule from memory of Python-Markdown internals. Every rule must be backed by an observed probe. If a probe contradicted a prior belief you held, call that out in surprises.',
    '- Obsess over whitespace, newline placement, attribute order inside tags, and HTML entity escaping: the reimplementation must match byte for byte.',
    '- Note that a lone backslash, a ' + BT + ' character, and a ' + BS + ' need care when you write JSON case files: JSON.stringify from a node script is the safest way to author them.',
    '',
    'Deliverables:',
    '1. /workspace/spec/' + a.key + '.md - a precise, implementation-ready spec. Structure it as numbered rules, each with a verbatim observed example (input as a JSON string, then output as a JSON string). State the ALGORITHM (ordering, precedence, edge conditions), not merely examples: an implementer will code against this file without access to the executable.',
    '2. /workspace/harness/corpus/' + a.key + '.json - a regression corpus: a JSON array of markdown source STRINGS only (no expected outputs; the harness re-derives them from the executable). Include every interesting case you probed, especially edge cases. Aim for 80 to 250 cases. It MUST parse with JSON.parse.',
    '3. The structured summary.',
    '',
    'Be exhaustive. Token cost is not a concern; byte-exact correctness is.',
  ].join('\n')
}

const results = await parallel(AREAS.map(a => () =>
  agent(probePrompt(a), { label: 'probe:' + a.key, phase: 'Probe', schema: SCHEMA })
))

const good = results.filter(Boolean)
log('probed ' + good.length + '/' + AREAS.length + ' areas, ' + good.reduce((s, r) => s + (r.corpusCases || 0), 0) + ' corpus cases')

phase('Critic')

const criticPrompt = [
  'Behavioral specs for a Python-Markdown ("extra" extensions) reimplementation were just written to /workspace/spec/*.md, with regression corpora in /workspace/harness/corpus/*.json.',
  '',
  'Read the specs. You are the COMPLETENESS CRITIC: find what is missing or contradictory BEFORE implementation starts.',
  '',
  'Look for:',
  '- Feature corners no spec covers. Check the spec set against everything the "extra" bundle can do (abbr, attr_list, def_list, fenced_code, footnotes, md_in_html, tables) plus core blocks and inlines, the serializer style for void elements, and postprocessing of raw HTML placeholders.',
  '- Two specs stating contradictory rules about the same input shape.',
  '- Rules stated without a supporting observed example, or hedged vaguely ("mostly", "usually", "seems to").',
  '- Unanswered ordering/precedence questions: which block processor wins when two could match a block, and inline pattern precedence.',
  '',
  'Verify every suspicion by probing: cd /workspace/harness && node probe.mjs -f /tmp/gap.json',
  '',
  'Write /workspace/spec/00-gaps.md as a prioritized list: each item = the gap, the probe you ran, the observed truth, and which spec file should own it. Also write /workspace/harness/corpus/gaps.json (valid JSON array of source strings) with the gap cases you probed.',
  '',
  'Return a concise summary of the highest-risk gaps an implementer must not miss.',
].join('\n')

const critique = await agent(criticPrompt, { label: 'completeness-critic', phase: 'Critic' })

return {
  areas: good.map(r => ({ area: r.area, probes: r.probeCount, cases: r.corpusCases, surprises: r.surprises })),
  critique,
}
