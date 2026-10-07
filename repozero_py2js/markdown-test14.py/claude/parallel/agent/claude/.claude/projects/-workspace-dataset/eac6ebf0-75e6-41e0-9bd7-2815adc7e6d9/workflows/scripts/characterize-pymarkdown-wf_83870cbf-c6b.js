export const meta = {
  name: 'characterize-pymarkdown',
  description: 'Black-box characterize Python-Markdown 3.10.2 core + toc via the test14 executable',
  phases: [
    { title: 'Probe', detail: 'parallel probing agents, one per feature area' },
    { title: 'Critique', detail: 'completeness critic finds unprobed behavior' },
    { title: 'Probe2', detail: 'follow-up probes for gaps' },
  ],
}

const GUIDE = `
# Target
\`/workspace/dataset/test14_executable --a <STR> --b <STR>\` is a PyInstaller build of this Python script:

    doc1 = f"## Section 1\\n{args.a}"
    doc2 = f"## Section 2\\n{args.b}"
    html1 = markdown.markdown(doc1)
    html2 = markdown.markdown(doc2)
    toc_md = "# Table of Contents\\n1. Section 1\\n2. Section 2"
    toc_html = markdown.markdown(toc_md, extensions=['toc'])
    final_doc = f"{toc_html}\\n\\n{html1}\\n\\n{html2}"
    final_html = markdown.markdown(final_doc)
    print(html1); print(html2); print(toc_html); print(final_html)

It bundles Python-Markdown **3.10.2** (no extensions except \`toc\` on the fixed toc_md). NO fenced_code, NO tables, NO nl2br, NO attr_list, NO smarty.

# Goal
We are reimplementing \`markdown.markdown()\` from scratch in pure JavaScript (no deps, no regex-hacks — a real character-scanning parser producing an element tree, exactly mirroring Python-Markdown's architecture: preprocessors -> block parser -> tree processors (inline) -> serializer -> postprocessors). Your job is to produce an EXACT, evidence-backed behavioral specification for your assigned area, precise enough that an implementer who has never seen Python-Markdown's source can reproduce byte-identical output.

# How to probe (IMPORTANT)
Use bash. To render an isolated document D (so the \`## Section 1\` prefix does not interfere), pass a leading newline so the doc becomes "## Section 1\\n\\nD":

    /workspace/dataset/test14_executable --a $'\\n\\nD_line1\\nD_line2' --b $'\\n\\nOTHER'

The FIRST printed block (up to the line \`<h2>Section 2</h2>\`) is markdown("## Section 1\\n" + a); the second (up to \`<h1 id="table-of-contents">\`) is markdown("## Section 2\\n" + b). Two independent probes per invocation.

Write a helper script to reduce noise, e.g. create /tmp/<yourarea>/p.sh:

    #!/bin/bash
    # usage: p.sh 'markdown text'   -> prints only html1 minus the leading <h2>Section 1</h2>
    out=$(/workspace/dataset/test14_executable --a "$(printf '\\n\\n%s' "$1")" --b 'z')
    printf '%s\\n' "$out" | sed -n '2,/^<h2>Section 2<\\/h2>$/p' | sed '$d' | cat -A | sed 's/\\$$//'

Use \`cat -A\` or \`od -c\` when trailing whitespace / exact newlines matter — trailing spaces and the presence/absence of a final newline are load-bearing for us. Beware: bash \`$(...)\` strips trailing newlines, so when trailing-newline behavior matters, write the markdown to a file and use \`--a "$(cat file)"\`-free approaches like python-free \`xargs\`? No — instead use: \`/workspace/dataset/test14_executable --a "$(printf 'x\\n\\n')" ...\` (printf inside the arg preserves them since it is one argv string). Prefer building args with \`printf\` into a bash variable using \`read -r -d ''\` or a heredoc-free literal \`$'...'\` string, which preserves trailing newlines exactly.

Do 40-120 probes. Be systematic: for each rule, find the boundary (what makes it stop applying).

# Output
Return a JSON object per the schema. Rules must be mechanical and implementable ("if the line, after stripping up to 3 leading spaces, begins with 1-6 '#' followed by ..."). Every rule needs at least one verified input/output pair copied VERBATIM from a real run. Flag anything you could not determine.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'rules', 'uncertainties'],
  properties: {
    area: { type: 'string' },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence'],
        properties: {
          rule: { type: 'string', description: 'Mechanical, implementable statement of behavior' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['input', 'output'],
              properties: {
                input: { type: 'string', description: 'The markdown source (use \\n for newlines)' },
                output: { type: 'string', description: 'Verbatim HTML produced' },
              },
            },
          },
        },
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

const AREAS = [
  {
    key: 'argparse',
    prompt: `AREA: command-line argument parsing (Python argparse) for \`--a\` (str, required) and \`--b\` (str, required).
Characterize EXACTLY, including exit codes and the exact bytes on stdout vs stderr:
- success forms: \`--a X --b Y\`, \`--a=X\`, \`--b=Y\`, order swapped, values that look like flags (\`--a -x\`, \`--a --b\`), values starting with \`-\`, empty string values, \`--\` separator usage, values containing \`=\`.
- duplicate flags (\`--a 1 --a 2\`) -> which wins.
- missing required args (each combination), missing value after flag, unrecognized args, positional extras.
- \`-h\` / \`--help\` exact output text and exit code. Also abbreviations: is \`--a\` ambiguous with anything? try \`-a\`, \`--A\`.
- Which stream does usage/error go to (test with \`2>/dev/null\` and \`1>/dev/null\`)? Exact exit codes.
Report the exact literal strings including the program name as it appears.`,
  },
  {
    key: 'preprocess',
    prompt: `AREA: document preprocessing / normalization, and overall output framing.
- Line ending handling: \\r\\n, lone \\r, mixed. Trailing newlines at end of document. Leading blank lines. A document that is empty or only whitespace -> what does markdown() return? (remember the real doc always starts with "## Section 1\\n").
- Tab expansion: is a tab equal to 4 columns? Is it column-aware or a naive 1->4 replacement? Probe \`\\tcode\`, \`a\\tb\`, \`  \\tx\`, \`\\t\\tx\` in code-block and list contexts.
- Trailing whitespace on lines: when is it stripped, when does it create \`<br />\`?
- Lines consisting only of spaces/tabs: do they count as blank separators?
- Does the final output end with a newline? (Python \`print\` adds one — determine whether markdown() itself returns a trailing newline by examining the exact bytes between the two printed sections.)
- Non-breaking spaces, form feed \\f, vertical tab, unicode line separators U+2028/U+2029, zero-width chars: treated as ordinary text or as line breaks?
- NUL bytes / control chars if passable.
- What happens with a document consisting only of "## Section 1\\n" (i.e. \`--a ''\`)?`,
  },
  {
    key: 'headers-hr',
    prompt: `AREA: ATX headers, setext headers, horizontal rules, and paragraph/blank-line block splitting.
- ATX: \`#\`..\`######\`, 7 hashes, no space after hash (\`#foo\`), closing hashes (\`## x ##\`, \`## x #####\`, \`## x # y\`), empty header (\`#\`, \`##\` alone, \`# #\`), leading 1/2/3/4 spaces before \`#\`, trailing spaces, header immediately after a paragraph line with no blank line, header immediately followed by text with no blank line, tabs after hashes.
- Setext: \`=\` and \`-\` underlines, 1 char vs many, with leading/trailing spaces, multi-line text above, underline after a blank line, \`-\` ambiguity with \`<hr>\` and with list items, setext where the text line is indented, mixed \`=-\`.
- HR: \`---\`, \`***\`, \`___\`, with spaces \`- - -\`, \`* * *\`, more than 3, exactly 2 (\`--\`), leading spaces 1-4, trailing text after (\`--- x\`), HR directly after paragraph line without blank line, HR inside/around lists.
- Block splitting: how many blank lines separate blocks; consecutive blocks; text after a header without blank line.`,
  },
  {
    key: 'lists',
    prompt: `AREA: ordered and unordered lists.
- Markers: \`*\`, \`+\`, \`-\`; \`1.\`, \`1)\`?, \`2.\` start value (does output get a start attribute?), \`0.\`, large numbers, \`1.\` with no space, multiple spaces after marker.
- Tight vs loose: when do \`<li>\` contents get wrapped in \`<p>\`? Blank line between items; blank line inside an item; multi-paragraph items; last item only.
- Continuation lines (lazy continuation, indented continuation), how indentation is normalized.
- Nesting: 1/2/3/4/5/8 spaces of indent for sublists, tab-indented sublists, mixed marker types, ul inside ol and vice versa, 3 levels deep. Exact indentation/newlines of the emitted nested \`<ul>\`/\`<ol>\` (copy output verbatim with cat -A).
- Switching marker type mid-list (does it start a new list?).
- Items containing: headers, blockquotes, indented code blocks (how many spaces needed), HRs, blank items, items that are only whitespace.
- A list immediately after a paragraph with no blank line. A list immediately after a header.
- List item text starting with a number-like or emphasis-like token.`,
  },
  {
    key: 'blockquote-code',
    prompt: `AREA: blockquotes and indented code blocks.
- Blockquote: \`> \` vs \`>\` with no space, \`>\` with 1-4 leading spaces, lazy continuation lines, blank \`>\` lines, nested \`>>\` and \`> >\`, blockquote containing headers/lists/code/HR/another blockquote, blockquote ending then paragraph, multiple paragraphs inside, exact emitted newlines/indentation (use cat -A).
- Indented code: 4 spaces, 5-8 spaces (extra preserved?), tab, mixed tabs/spaces, blank lines inside a code block (how many trailing blank lines are kept? is a trailing newline added before \`</code></pre>\`?), code block at document start vs after a paragraph (needs blank line?), code containing \`<\`, \`&\`, \`>\`, \`"\`, \`'\`, backticks, markdown syntax (must be literal), unicode.
- What exactly does \`<pre><code>\` output look like byte for byte, including the newline before \`</code></pre>\`?
- Code block directly adjacent to a list or blockquote.`,
  },
  {
    key: 'inline-code-escape',
    prompt: `AREA: inline code spans, backslash escapes, and entity/ampersand handling.
- Code spans: single, double, triple, quadruple backticks; unmatched/odd counts; backticks inside; leading/trailing spaces inside a span (stripped?); spans containing newlines (multi-line spans — CRITICAL, see the fenced-code-block case where \\\`\\\`\\\`python\\n...\\n\\\`\\\`\\\` becomes one \`<code>\` span); empty span \\\`\\\`; span containing \`<\`, \`&\`, \`>\`, \`"\`, \`'\` (exact escaping); span containing \`\\\\\` and markdown chars; a span spanning a blank line (does it?); interaction with a code span at the very start/end of a paragraph.
- Backslash escapes: which characters are escapable (\`\\\\ \\\` \\* \\_ \\{ \\} \\[ \\] \\( \\) \\# \\+ \\- \\. \\! \\< \\> \\| \\: \\" \\' \\& \\~ \\^ \\= \\, \\/ \\; \\? \\@ \\$ \\% \\a \\1 \\newline \\space)? What does a backslash before a non-escapable char produce? Backslash at end of line / end of document. Backslash inside code spans. Double backslash.
- Ampersands and entities: bare \`&\`, \`&amp;\`, \`&#65;\`, \`&#x41;\`, \`&nbsp;\`, \`&notarealentity;\`, \`&amp\` (no semicolon), \`&#\`, \`& amp;\`, \`&&\`, \`&\` in a URL, \`&\` in a code span, \`<\` and \`>\` bare, \`"\` and \`'\` bare in text vs in attributes. Give the exact escaping table.`,
  },
  {
    key: 'emphasis',
    prompt: `AREA: emphasis / strong emphasis (Python-Markdown 3.x "smart emphasis" default).
Exhaustively determine the rules for \`*\` and \`_\`:
- \`*x*\`, \`**x**\`, \`***x***\`, \`****x****\`, \`*****x*****\`, and the \`_\` equivalents.
- Intra-word: \`a*b*c\`, \`a**b**c\`, \`a_b_c\`, \`a__b__c\`, \`snake_case_name\`, \`__init__\`, \`a_b\`, \`_a_b_\`.
- Unmatched/asymmetric: \`*x\`, \`x*\`, \`**x*\`, \`*x**\`, \`***x*\`, \`*x***\`.
- Spaces adjacent to delimiters: \`* x *\`, \`*x *\`, \`* x*\`, \`** x **\`.
- Nesting: \`*a **b** c*\`, \`**a *b* c**\`, \`*a _b_ c*\`, \`**_x_**\`, \`_**x**_\`, \`*a*b*c*\`, \`**a**b**c**\`.
- Multi-line spans (emphasis opened on one line, closed on the next within the same paragraph).
- Emphasis adjacent to punctuation, CJK characters (e.g. \`中*文*字\`), digits.
- Interaction with escapes (\`\\*not em*\`) and code spans.
Report as precise delimiter-matching rules (what counts as a valid opener/closer), not just examples — but back every rule with verbatim evidence.`,
  },
  {
    key: 'links-images',
    prompt: `AREA: links, images, autolinks, reference definitions, and \`<br />\` line breaks.
- Inline links: \`[t](u)\`, empty url \`[t]()\`, url in angle brackets, url with spaces (quoted/unquoted), titles with \`"\`/\`'\`/\`()\`, nested parens in url, url with \`&\`, url needing escaping, empty text, link text containing emphasis/code/brackets, unmatched brackets.
- Images: \`![alt](u)\`, title, empty alt, alt containing markup.
- Autolinks: \`<http://x.com>\`, \`<https://...>\`, \`<ftp://..>\`, \`<mailto:a@b.c>\`, \`<a@b.c>\` (email obfuscation — report the exact entity-encoded output and whether it is deterministic across runs), bare \`http://x.com\` (linked or not?), \`<not a url>\`.
- Reference links: \`[t][id]\`, \`[t][]\`, \`[t]\` shortcut, definitions \`[id]: url "title"\`, case-insensitivity, definition placement (before/after use, inside blockquote/list), multi-line definitions, undefined references, definition-only document.
- Line breaks: exactly how many trailing spaces produce \`<br />\`? (1, 2, 3, tab?) Where does the newline go relative to \`<br />\`? Trailing spaces on the last line of a paragraph. Trailing backslash.
- Angle-bracket-ish text that is not a link: \`a < b\`, \`<3\`, \`<-\`, \`a<b>c\`.`,
  },
  {
    key: 'rawhtml-1',
    prompt: `AREA: raw HTML **block** handling (the htmlblock preprocessor / \`md_in_html\`-off default). THIS IS THE MOST IMPORTANT AREA for us, because the script re-runs markdown() over already-generated HTML.
Determine precisely when a chunk of input is passed through verbatim as a raw HTML block vs. wrapped in \`<p>\`:
- A lone block tag on its own line: \`<div>x</div>\`, \`<p>x</p>\`, \`<h1>x</h1>\`, \`<ol>\`/\`<li>\`, \`<pre>\`, \`<blockquote>\`, \`<table>\`, \`<hr>\`, \`<hr />\`, \`<em>x</em>\`, \`<span>x</span>\`, \`<code>x</code>\`, \`<b>x</b>\`, \`<a href="">x</a>\` — which are treated as block-level (verbatim) and which as inline (wrapped in \`<p>\`)? Produce the full block-level tag list you can verify.
- Multi-line elements: open tag on one line, content on following lines, close tag later, with and without intervening blank lines. Does a blank line inside \`<div>...\n\n...</div>\` split it?
- Unclosed tags, mismatched close tags, stray \`</div>\`, nested same-name tags.
- Attributes: quoted with \`"\` and \`'\`, unquoted, containing \`>\`, multi-line attribute lists, boolean attributes, \`id="table-of-contents"\` style.
- Text on the same line before/after the tag: \`x <div>y</div>\`, \`<div>y</div> x\`.
- Markdown inside a raw HTML block: is it processed? (\`<div>\n**x**\n</div>\`, \`<p>*y*</p>\`)
- Are \`&\`, \`<\`, \`>\` inside a raw HTML block left untouched? What about \`&amp;\` (double-escaped?) and \`&nbsp;\`?
- Indented block tags (1-3 spaces, 4 spaces).
- Comments \`<!-- ... -->\` (single & multi-line, containing blank lines, containing \`--\`), processing instructions \`<?php ?>\`, declarations \`<!DOCTYPE>\`, CDATA \`<![CDATA[..]]>\`.
Give verbatim byte-exact outputs (cat -A) — especially how many blank lines survive around raw HTML blocks.`,
  },
  {
    key: 'rawhtml-2',
    prompt: `AREA: the exact \`final_html\` reprocessing pass — round-tripping generated HTML through markdown() again.
The script computes \`final_doc = toc_html + "\\n\\n" + html1 + "\\n\\n" + html2\` and renders it. Your job: characterize this second pass so we can reproduce it exactly.
Probe by choosing \`--a\`/\`--b\` values that make html1/html2 contain each interesting HTML shape, then compare the 4th printed block (final_html) with the inputs:
- Sequences like \`<h2>Section 1</h2>\\n<p>text</p>\` — preserved verbatim? Where exactly do blank lines appear in final_html vs. the concatenation?
- \`<ol>\\n<li>a</li>\\n</ol>\` blocks, nested lists, \`<blockquote>\\n<p>x</p>\\n</blockquote>\`, \`<pre><code>x\\n</code></pre>\`, \`<p><code>a\\nb</code></p>\` (multi-line inline code — does the second pass re-mangle it?), \`<p>a<br />\\nb</p>\`, \`<h1 id="table-of-contents">\`, \`<a href="...">\`, \`<em>\`/\`<strong>\` inside \`<p>\`.
- Cases where the second pass CHANGES the HTML (e.g. entities re-escaped, \`&amp;\` -> ?, \`_\`/\`*\` inside a \`<pre>\` or \`<code>\` block getting emphasized, a \`<p>\` containing \`*\` text, indented content inside \`<pre>\` becoming something else, \`<li>1. x</li>\`).
- What happens when html1 contains a 4-space-indented line (e.g. from a code block) — does the second pass turn it into \`<pre><code>\`?
- What happens when html1 is EMPTY (\`--a ''\` -> html1 is just \`<h2>Section 1</h2>\`)? And when html1 ends with a blank line?
- Blank-line runs: 2, 3, 4 consecutive newlines between HTML blocks in final_doc.
Deliver a precise rule set for how the second pass transforms already-rendered HTML, with verbatim before/after evidence.`,
  },
  {
    key: 'toc-ext',
    prompt: `AREA: the \`toc\` extension, as applied to the FIXED input \`"# Table of Contents\\n1. Section 1\\n2. Section 2"\`, plus its general behavior.
- Confirm the exact byte-for-byte output for that fixed input (this is a constant in our program) — run it and copy verbatim.
- Then characterize the toc extension generally so we can implement it honestly: id slugification (lowercase? spaces->\`-\`? punctuation stripped? leading/trailing separators? multiple spaces? unicode/CJK — probe by making \`--a\` a heading... note: the toc extension is ONLY applied to the fixed toc_md, so you must reason about what you can and cannot observe. State clearly which parts are unobservable through this binary and therefore only need to satisfy the fixed input.)
- Does the toc extension change anything else about the output (e.g. \`<div class="toc">\` marker only when \`[TOC]\` present, permalinks, header id on all levels)? Verify \`[TOC]\` is NOT in the fixed input, so no toc div appears.
- Confirm whether the \`toc\` extension affects list rendering or anything beyond header ids for this input.`,
  },
  {
    key: 'unicode-cjk',
    prompt: `AREA: unicode, CJK and mixed-script behavior, plus stress/adversarial inputs.
The real test suite uses Chinese text heavily (e.g. \`普通段落\\n\\n另一个段落\`, \`# 大标题\`, \`- 苹果\`). Verify:
- CJK in paragraphs, headers, list items, code spans, code blocks, blockquotes, links — any surprises? Full-width punctuation \`。\`\`，\`\`（）\`\`｜\`, CJK adjacent to \`*\`/\`_\`/\`#\`, CJK with trailing double space (\`<br />\`).
- Emoji / astral-plane characters (surrogate pairs in JS!) — e.g. \`😀\` in a header, in emphasis, adjacent to \`*\`. Also combining marks, RTL text, \`\\u00a0\`.
- Whether any character-class decision (word boundary for smart emphasis, id slugification) treats CJK as a "word" character. Probe \`中*文*字\`, \`中文_下_线\`, \`ａ_ｂ_ｃ\` (full-width latin).
- Adversarial/pathological inputs that might crash or produce surprising output: very long lines, deeply nested \`>>>>>>\`, many unmatched brackets \`[[[[\`, \`*\`*20, mixed \`\\\`\\\`\\\`\` counts, a line of only \`|\` pipes (markdown table syntax WITHOUT the tables extension — confirm it stays literal in a \`<p>\`, matching sample test 1), \`~~strike~~\` (no extension -> literal), \`- [ ] task\`, footnote syntax \`[^1]\`, definition-list syntax, abbreviations.
- Report anything that errors or produces a non-zero exit code.`,
  },
]

phase('Probe')
const specs = await parallel(AREAS.map(a => () =>
  agent(`${GUIDE}\n\n----\n${a.prompt}`, { label: `probe:${a.key}`, phase: 'Probe', schema: SCHEMA, effort: 'high' })
))

const good = specs.filter(Boolean)
log(`${good.length}/${AREAS.length} area specs returned; ${good.reduce((n, s) => n + (s.rules?.length || 0), 0)} rules total`)

phase('Critique')
const digest = good.map(s => `## ${s.area}\n${(s.rules || []).map(r => `- ${r.rule}`).join('\n')}\nUNCERTAIN: ${(s.uncertainties || []).join(' | ')}`).join('\n\n')

const CRIT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['question', 'why'],
        properties: { question: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
}

const crits = await parallel([
  'You are a completeness critic for a Python-Markdown-to-JavaScript reimplementation effort.',
  'You are an adversarial critic hunting for behaviors that would cause byte-level output mismatches.',
  'You are a critic focused on INTERACTIONS between features (block x inline x raw-html x second-pass) that single-area probing misses.',
].map((persona, i) => () => agent(
  `${persona}\n\nBelow is the digest of behavioral rules gathered so far by black-box probing of Python-Markdown 3.10.2 (core + toc only).\n\n${digest}\n\n---\nIdentify the most important REMAINING unknowns: behaviors an implementer would still have to guess at, and which are plausibly exercised by inputs like arbitrary markdown text passed as \`--a\`/\`--b\` (the test suite favors: headings, paragraphs, ordered/unordered lists, code fences (which are NOT supported and degrade to code spans), pipe-tables (NOT supported), CJK text, blockquotes, inline emphasis, links, raw HTML). Return 6-14 concrete, answerable probe questions. Prefer questions whose answer changes emitted bytes. Do not repeat what the digest already settles.`,
  { label: `critic:${i + 1}`, phase: 'Critique', schema: CRIT_SCHEMA, effort: 'high' })))

const gaps = crits.filter(Boolean).flatMap(c => c.gaps || [])
log(`critics raised ${gaps.length} gap questions`)

phase('Probe2')
const followups = await parallel(gaps.slice(0, 24).map((g, i) => () =>
  agent(`${GUIDE}\n\n----\nAREA: targeted follow-up probe #${i + 1}.\n\nQUESTION: ${g.question}\nWHY IT MATTERS: ${g.why}\n\nAnswer it definitively by probing the executable. Run as many probes as needed (10-40). Return rules + verbatim evidence. If the question turns out to be unobservable through this binary, say so in \`uncertainties\`.`,
    { label: `gap:${i + 1}`, phase: 'Probe2', schema: SCHEMA, effort: 'high' })))

return {
  areaSpecs: good,
  gapSpecs: followups.filter(Boolean),
}
