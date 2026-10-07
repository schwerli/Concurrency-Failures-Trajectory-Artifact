export const meta = {
  name: 'probe-pymarkdown',
  description: 'Exhaustively probe the Python-Markdown 3.10.2 reference executable and write per-area behavioral specs',
  phases: [
    { title: 'Probe', detail: 'one agent per feature area, hammering the executable' },
    { title: 'Gapfill', detail: 'completeness critic finds unprobed corners, then reprobes' },
  ],
}

const PROBE_INTRO = `
You are reverse-engineering the EXACT behavior of Python-Markdown 3.10.2 (running on Python 3.12)
so it can be reimplemented byte-for-byte in JavaScript.

TOOL: run
    node /tmp/pm.mjs '<markdown text>'
It prints the rendering of that ONE input under all three configurations:
  core   = markdown.markdown(x)                        (no extensions)
  tables = markdown.markdown(x, extensions=['tables'])
  extra  = markdown.markdown(x, extensions=['extra'])
plus a JSON-escaped copy of each output so you can see exact whitespace.
In the inline form, the two-char sequences \\n \\t \\r \\\\ are unescaped for you.
For inputs with awkward quoting, write the markdown to a file and use:
    node /tmp/pm.mjs --file /tmp/probes/scratch_<yourarea>.md

RULES:
- Probe RELENTLESSLY. Run at least 60-120 distinct probes. Vary one thing at a time.
- Deliberately hunt EDGE CASES and failure modes, not just the happy path:
  empty input, whitespace-only, leading/trailing blank lines, tabs (tab_length=4,
  Python expandtabs is COLUMN-aware not a fixed replacement), CRLF and lone CR,
  lines that are only spaces, missing terminators, unclosed constructs, deeply nested
  constructs, interactions between two features, CJK/unicode, characters that are
  HTML-special (< > & " '), backslash escapes of every punctuation char.
- Note exact whitespace and newline placement. Python-Markdown's "prettify" treeprocessor
  inserts newlines in specific places; the serializer is XHTML (<hr />, <br />).
- Where core / tables / extra DIFFER for the same input, that difference is important — record it.

DELIVERABLE: write a markdown spec file to the path given below. Structure it as:
  1. RULES — precise, implementable prose describing the algorithm you inferred,
     including priority/ordering effects and any surprising behavior.
  2. VECTORS — a fenced block of one JSON object per line (JSONL), each
     {"md": <input string>, "core": <output>, "tables": <output>, "extra": <output>}
     using the exact JSON strings the probe tool printed. Include EVERY probe you ran
     that revealed something (aim for 60+ lines). These become the differential test corpus.
Then return a CONCISE summary (<= 40 lines) of the rules only — do NOT paste the vectors
into your reply, they are already on disk.
`

const AREAS = [
  {
    key: 'preprocess',
    file: '/tmp/probes/01-preprocess.md',
    focus: `Document-level preprocessing and overall pipeline shape.
- What happens to a completely empty document, whitespace-only, "\\n\\n\\n".
- Tab expansion: Python str.expandtabs(4) is COLUMN aware ("a\\tb" -> "a   b", "\\tx" -> "    x",
  "ab\\tc" -> "ab  c"). Verify against indented code blocks and list indentation.
- CRLF / lone CR normalization. Trailing whitespace on lines. Lines containing only spaces
  between two paragraphs (do they split blocks?). A spaces-only FIRST line.
- Leading blank lines, trailing blank lines, no trailing newline.
- Control chars U+0002 (STX) and U+0003 (ETX) in the input — Markdown uses these internally.
- Very long documents, and whether the final output ever ends with a newline.
- Unicode: CJK, emoji, combining marks, NBSP, zero-width chars. Whether any normalization happens.`,
  },
  {
    key: 'rawhtml',
    file: '/tmp/probes/02-rawhtml.md',
    focus: `RAW HTML BLOCK HANDLING — the hardest area. Markdown 3.x uses a subclass of Python's
html.parser.HTMLParser to find and stash raw HTML.
- Block-level tags at column 0 (<div>, <p>, <table>, <html>...) vs inline tags (<b>, <span>, <em>).
- The provided test case shows: input "\`\`\`html\\n<html>\\n  <body>\\n    <h1>x</h1>\\n  </body>\\n</html>\\n\`\`\`"
  renders under core as "<p>\`\`\`html</p>\\n<html>\\n  <body>\\n    <h1>x</h1>\\n  </body>\\n</html>\\n<p>\`\`\`</p>".
  Explain PRECISELY why, and generalize the rule (raw html splits the surrounding text into blocks).
- Is the stashed HTML reproduced verbatim (indentation preserved)? Is it re-serialized?
- Unclosed tags. Mismatched tags. Self-closing <br/>, <hr />. Void elements.
- <!-- comments --> (single & multi-line), <?php ... ?>, <!DOCTYPE ...>, <![CDATA[...]]>.
- <script> and <style> bodies (html.parser treats these as CDATA — markdown inside must NOT be processed).
- Indented HTML (1,2,3,4 spaces). HTML inside blockquotes and list items.
- Blank lines INSIDE an html block. Text on the same line as a closing tag.
- Attributes: quoted, single-quoted, unquoted, empty, boolean, weird spacing, uppercase tag names.
- Inline html inside a paragraph (<b>x</b>) vs a standalone line.
- Malformed input: a bare "<", "a < b", "<3", "<not a tag>", "< div>".
- Does markdown INSIDE a raw html block get processed? (default: no)`,
  },
  {
    key: 'blocks',
    file: '/tmp/probes/03-blocks.md',
    focus: `Core block constructs (NOT lists, they have their own agent).
- ATX headers: #..###### , 7 hashes, closing hashes, "#no-space" (does it need a space in 3.10?),
  "#" alone, trailing hashes with spaces, header with inline markup, indented 1-3 spaces vs 4.
- Setext headers: ===, ---, minimum lengths, with trailing spaces, multi-line paragraph before.
- Horizontal rules: ---, ***, ___, with spaces "- - -", "* * *", minimum 3, more than 3,
  vs setext ambiguity, vs list-item ambiguity ("- - -" vs "-").
- Indented code blocks: 4 spaces, 8 spaces, tabs, blank lines inside, trailing blank lines,
  first-line-only, interaction with a preceding paragraph (does it need a blank line?).
  Exact trailing newline inside <pre><code>.
- Blockquotes: >, > with no space, nested >>, lazy continuation, blank line inside,
  blockquote containing code/headers/lists/hr, ">" alone, "  >" indented.
- Paragraph splitting rules generally; a block separated by a spaces-only line.
- HTML escaping of text: <, >, &, ", ' in paragraph text and in code blocks.`,
  },
  {
    key: 'lists',
    file: '/tmp/probes/04-lists.md',
    focus: `LISTS — ordered and unordered. Markdown's list handling is notoriously subtle.
- Markers: -, +, *, and 1. 2. 1) ... does ')' work in 3.10 core?
- Does the ordered list get a start="N" attribute when it starts at a number != 1? Test 3., 0., 5.
- Loose vs tight lists (blank line between items -> <p> wrapping). Partial looseness.
- Nested lists: 2-space, 3-space, 4-space, 8-space indentation. Mixing ul inside ol.
- Changing the marker mid-list (does it start a new list?). Mixing 1. and - .
- List item containing: multiple paragraphs, a code block, a blockquote, a nested list, an hr.
- Lazy continuation lines. A list immediately after a paragraph with no blank line.
- Empty list items. Items with only whitespace. A single-item list.
- Indented 4 spaces at top level (code block vs list?).
- Interaction: list item text starting with a number, or containing a marker char.
- Exact newline/indentation placement in the emitted <ul>/<ol>/<li> HTML (the prettify pass).`,
  },
  {
    key: 'inline',
    file: '/tmp/probes/05-inline.md',
    focus: `INLINE parsing (all in core, no extensions needed).
- Emphasis: *em*, _em_, **strong**, __strong__, ***both***, ___both___, ****x****.
  Intra-word: "a*b*c" vs "a_b_c" (smart_emphasis is ON by default in 3.x — underscores
  do NOT work intra-word but asterisks do). Verify. Unmatched/unbalanced markers.
  Nesting: *a **b** c*, **a *b* c**. Adjacent: *a**b*. Empty: ** **, ****.
- Code spans: \`x\`, \`\`x\`\`, \`\`\` x \`\`\`, backtick inside code, leading/trailing space stripping,
  a code span containing <, &, *, and a newline. Unmatched backticks.
- Backslash escapes: try every ASCII punctuation char. Which are escapable? What about \\n at EOL?
- Line breaks: two trailing spaces -> <br />. Three spaces. One space. Trailing space at end of para.
- Autolinks: <http://x>, <https://x>, <ftp://x>, <mailto:a@b.c>, <a@b.c> (email obfuscation —
  Python-Markdown encodes emails as HTML entities; capture the EXACT output).
- Entities: &amp; &copy; &#169; &#xA9; &bogus; and a bare & . Exact escaping rules.
- Raw "<" and ">" in text. Quotes " and ' in text and in attributes.
- Inline HTML inside a paragraph and how it survives.
- Interaction of code spans with everything else (code spans win — verify priority).`,
  },
  {
    key: 'links',
    file: '/tmp/probes/06-links.md',
    focus: `LINKS, IMAGES, and REFERENCE DEFINITIONS.
- Inline links: [t](u), [t](u "title"), [t](u 'title'), [t](u (title)), [t](<u>), [t]().
- URLs containing spaces, parens (balanced and unbalanced), quotes, angle brackets.
- Reference links: [t][id], [t][], [t] (implicit/shortcut). Case-insensitivity of ids.
- Reference definitions: "[id]: url", with title on the same line and on the NEXT line,
  indented 0-3 vs 4 spaces, id with spaces/brackets, definition inside a list or blockquote,
  a definition that is never used, a link to an undefined reference.
- Images: ![alt](src), ![alt][ref], nested inside a link. Empty alt. Exact ATTRIBUTE ORDER
  in the emitted <img ... /> (the probe output shows alt before src — confirm and generalize
  the attribute ordering rule for all elements).
- Escaping inside URLs and titles: &, <, ", spaces, and already-encoded %20.
- Nested brackets in link text: [a [b] c](u). Emphasis inside link text.
- A link whose text contains a code span or an image.`,
  },
  {
    key: 'serializer',
    file: '/tmp/probes/07-serializer.md',
    focus: `OUTPUT SERIALIZATION and the "prettify" pass — exact bytes.
Goal: derive the rule for where newlines appear in the output.
- Which elements get a newline before/after/inside? Compare <p>, <div>, <ul>/<li>,
  <blockquote>, <pre><code>, <table>/<tr>/<td>, <h1>, <hr />, <br />.
- Empty elements: does an empty <p></p> collapse to <p />? Test an empty blockquote,
  empty list item, empty header, <a href="x"></a>.
- Void/self-closing form: <hr />, <br />, <img />. Is there always a space before "/>"?
- Attribute escaping: values containing " ' < > & and newlines.
- Attribute ORDER: is it insertion order? Probe an <img> and a <th style=...>.
- Text escaping in different contexts: inside <pre><code>, inside <p>, inside an attribute.
- Whether the overall output has a trailing newline (it appears NOT to).
- Nested inline elements and where whitespace lands: <p><em>a</em> <strong>b</strong></p>.
- <br /> produced by two-space line break: exact surrounding whitespace.`,
  },
  {
    key: 'tables',
    file: '/tmp/probes/08-tables.md',
    focus: `The 'tables' extension (mode b) — and confirm it is ALSO active under 'extra'.
- Minimum valid table. Delimiter row forms: ---, :---, ---:, :---:, -, ::, and invalid ones.
- Leading/trailing pipes optional? Ragged rows (more/fewer cells than the header).
- Escaped pipes \\| in cells. A pipe inside a code span in a cell. A pipe inside inline HTML.
- Empty cells, cells with only spaces, a header with an empty cell.
- Inline markup inside cells (emphasis, links, code, images).
- The exact style attribute for alignment ("text-align: left;" etc) and which elements get it.
- A table immediately after a paragraph (no blank line). A table inside a blockquote / list item.
- A single-column table. A table with only a header and delimiter (no body rows) — is <tbody> emitted?
- Whitespace/newline layout of the emitted table HTML, exactly.
- What makes a would-be table NOT parse as a table (falls back to a paragraph).`,
  },
  {
    key: 'fenced',
    file: '/tmp/probes/09-fenced.md',
    focus: `The 'fenced_code' extension (active only under 'extra', mode c).
- Backtick fences (3, 4, 5+) and tilde fences (~~~). Mismatched fence lengths.
- Language: \`\`\`python -> what class attribute exactly? \`\`\`{.python}? \`\`\`{ .python #id }?
  Is the class "language-python" or "python"? Capture exact output.
- No language. Language with weird chars. Trailing text after the language.
- Unclosed fence (runs to end of document?). Empty fence. Fence containing blank lines.
- Fence containing <, &, backticks, and markdown syntax (must NOT be processed).
- Indented fence (0-3 spaces, and 4 spaces). Fence inside a list item / blockquote.
- Exact trailing newline inside <pre><code>.
- IMPORTANT baseline: under core and tables (no fenced_code), what does \`\`\`lang\\ncode\\n\`\`\` do?
  The given test case shows it becomes a <p> with a <code> span. Characterize that fully too.`,
  },
  {
    key: 'attrlist-deflist',
    file: '/tmp/probes/10-attrlist-deflist.md',
    focus: `Two 'extra' sub-extensions (mode c only).
ATTR_LIST:
- {: #id .class key=value } and the no-colon form {#id .cls} on: headers, paragraphs (last line),
  list items, table cells, fenced code, and INLINE elements (emphasis, links, images, code spans).
- Multiple classes. key="quoted value". Bare words. The special "." and "#" shorthands.
- Where the attr list must be positioned. What happens when it does not apply (left as text?).
- Resulting attribute ORDER in the output.
DEF_LIST:
- "Term\\n:   Definition". Multiple terms per definition, multiple definitions per term.
- Loose (blank line) vs tight -> when does <dd> get a <p> inside?
- Multi-paragraph definitions, nested lists inside a definition, indentation rules (spaces vs tab).
- A definition list immediately after a paragraph. Exact newline layout of <dl>/<dt>/<dd>.`,
  },
  {
    key: 'footnotes-abbr',
    file: '/tmp/probes/11-footnotes-abbr.md',
    focus: `Two more 'extra' sub-extensions (mode c only).
FOOTNOTES:
- [^1] refs and "[^1]: text" definitions. Capture the FULL exact output including the
  trailing <div class="footnote"> block, the &#160; and &#8617; entities, ids fn:/fnref:,
  the title attribute text, and the <hr />.
- Multiple footnotes: are they ordered by first reference or by definition order? Numbering?
- Non-numeric labels [^note]. Duplicate refs to the same footnote (multiple backrefs?).
- Multi-paragraph footnote definitions (indented continuation). A footnote containing a list/code.
- An undefined ref. A defined-but-unused footnote. A footnote inside a blockquote/list.
- Where the footnote div is placed relative to the rest of the document.
ABBR:
- "*[HTML]: HyperText Markup Language" definitions and how occurrences in the text become
  <abbr title="...">. Case sensitivity. Partial-word matches (must NOT match inside a word).
- Multiple abbreviations, an abbr inside a link/heading/code span, an unused definition.
- Definition placement (anywhere in the doc?). Special chars in the abbreviation.`,
  },
  {
    key: 'mdinhtml',
    file: '/tmp/probes/12-mdinhtml.md',
    focus: `The 'md_in_html' extension (active under 'extra' only) — and the CORE/TABLES contrast.
- <div markdown="1">\\n*em*\\n</div> under extra vs under core. Also markdown="block", "span", "0".
- Nested markdown="1" containers. A markdown="1" element inside a list.
- <p markdown="1">, <span markdown="1">, <td markdown="1">, <div markdown=1> (unquoted).
- Block vs span handling: which tags are treated as block containers?
- Raw HTML with NO markdown attribute under extra — should behave like core; verify it does.
- Indentation of content inside the container; blank lines inside; the exact output layout.
- Interaction with fenced code inside a markdown="1" div.
- Also record: any OTHER differences between core and extra for plain raw-HTML documents,
  since extra swaps in a different raw-html handler.`,
  },
]

phase('Probe')

const results = await parallel(AREAS.map(a => () => agent(
  `${PROBE_INTRO}

=== YOUR AREA: ${a.key} ===
${a.focus}

Write your spec to: ${a.file}
`,
  { label: `probe:${a.key}`, phase: 'Probe' }
)))

phase('Gapfill')

const summary = AREAS.map((a, i) => `## ${a.key} (${a.file})\n${results[i] || '(agent failed)'}`).join('\n\n')

const gaps = await parallel([
  () => agent(
    `You are a COMPLETENESS CRITIC for a reverse-engineering effort on Python-Markdown 3.10.2.
Below are summaries from 12 probing agents. Read the spec files in /tmp/probes/ for detail.

Your job: identify what is STILL UNKNOWN or UNDERSPECIFIED — behaviors that a reimplementer
would have to guess at. Then PROBE THOSE YOURSELF using: node /tmp/pm.mjs '<text>'
Focus especially on INTERACTIONS BETWEEN AREAS that no single agent would have covered
(e.g. a table inside a list inside a blockquote; a footnote whose text contains a fenced block;
attr_list on a table cell; raw HTML adjacent to a definition list; a code span containing a pipe
inside a table cell inside a list).
Run at least 80 probes. Write findings to /tmp/probes/13-gaps.md in the same
RULES + JSONL VECTORS format. Return a concise summary of the newly-discovered rules only.

${summary}`,
    { label: 'critic:gaps', phase: 'Gapfill' }
  ),
  () => agent(
    `You are probing the ARGUMENT PARSING and process behavior of /workspace/dataset/test11_executable,
which is a PyInstaller build of this Python program:

    parser = argparse.ArgumentParser(description="Markdown with extension configuration")
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    parser.add_argument('--c', type=str, required=True)
    args = parser.parse_args()
    ... print(html_a); print(html_b); print(html_c)

Determine EXACTLY, by running it:
- --help / -h output (exact bytes, including the usage line and program name shown).
- Missing one/two/all required args: exact stderr text and exit code.
- Unknown argument: exact stderr and exit code.
- "--a" with no value. "--a=value" form. Abbreviation forms: does argparse allow "--a" only,
  or are there prefix-matching quirks with three single-letter options?
- Repeated "--a x --a y" (last wins?).
- Values that look like options ("--a --b"). The "--" separator. Positional extras.
- Empty string values. Values with newlines, unicode, leading dashes.
- Exit code on success. Where output goes (stdout vs stderr).
- The program name argparse prints (argv[0] basename).
Write your findings to /tmp/probes/14-cli.md with exact expected stderr text in JSON-escaped form.
Return a concise summary.`,
    { label: 'probe:cli', phase: 'Gapfill' }
  ),
])

return { areas: AREAS.map(a => a.file), gapFiles: ['/tmp/probes/13-gaps.md', '/tmp/probes/14-cli.md'], gaps }
