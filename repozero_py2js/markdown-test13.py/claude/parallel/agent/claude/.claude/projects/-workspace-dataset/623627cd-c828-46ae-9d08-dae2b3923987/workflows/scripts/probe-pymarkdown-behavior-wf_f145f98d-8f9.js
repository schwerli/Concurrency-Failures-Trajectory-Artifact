export const meta = {
  name: 'probe-pymarkdown-behavior',
  description: 'Exhaustively probe Python-Markdown behavior via the test13 executable to build a port spec',
  phases: [
    { title: 'Probe', detail: 'parallel behavioral probes per feature area' },
    { title: 'Spec', detail: 'synthesize a single implementation spec' },
  ],
}

const EXE = '/workspace/dataset/test13_executable'

const PREAMBLE = `
You are reverse-engineering a Python program so it can be reimplemented in JavaScript.

The program is at ${EXE}. Its source is:

    parser = argparse.ArgumentParser(description="Markdown with extension configuration")
    parser.add_argument('--a', type=str, required=True)
    parser.add_argument('--b', type=str, required=True)
    parser.add_argument('--c', type=str, required=True)
    args = parser.parse_args()
    html1 = markdown.markdown(args.a, extensions=['extra', 'tables'])
    html2 = markdown.markdown(args.b, extensions=['codehilite'])
    html3 = markdown.markdown(args.c, extensions=['fenced_code', 'toc'])
    combined = markdown.markdown(f"{html1}\\n{html2}\\n{html3}")
    print(html1); print(html2); print(html3); print(combined)

So: --a is parsed with extensions [extra, tables]; --b with [codehilite]; --c with [fenced_code, toc];
and the concatenation is re-parsed with NO extensions.

HOW TO RUN PROBES (bash). Use $'...' quoting so \\n becomes a real newline:
    ${EXE} --a $'line1\\nline2' --b 'x' --c 'y'
To isolate one channel, put a trivial marker in the other two, e.g. --b 'B' --c 'C'.
To see exact bytes including trailing whitespace, pipe through: | cat -A     (or | od -c for tricky cases)
Run MANY probes. Batch several probes per bash call with echo separators so you use few tools calls.
Never use the 'python' command. Only run the executable.

YOUR OUTPUT is a technical spec fragment, not prose for a human. For every behavior you establish,
give the exact input and the exact output bytes. Be precise about: leading/trailing newlines, whether
blocks are separated by a blank line, exact attribute order and quoting, exact whitespace inside tags.
Report SURPRISES loudly — cases where the output is not what a CommonMark implementation would produce.
Do NOT speculate; if you did not run it, do not claim it. Aim for a dense, complete, correct report.
`

const AREAS = [
  {
    key: 'argparse',
    prompt: `AREA: command-line argument parsing (Python argparse).
Establish exactly, by probing:
1. Success and failure exit codes (echo "RC=$?" after each).
2. Exact stderr text for: no args at all; only --a; only --a and --b; missing one of three; unknown option --z;
   --a given twice (last wins?); --a with no value; empty string values ('').
3. Which stream each message goes to (test with 2>/dev/null and 1>/dev/null).
4. Exact --help / -h output byte-for-byte (use | cat -A to see trailing spaces), and its exit code.
   Also test -h mixed with other args, and --help after --a.
5. Prefix abbreviation: does '--' + unique prefix work? Try --a vs -a (single dash). Try --a=VALUE syntax.
   Try abbreviations of --help like --hel, --h.
6. Values that look like options: --a '--b', --a '-x', --a -- (bare --), the '--' separator followed by values.
   Does argparse accept a negative-number-looking value, e.g. --a -5 ?
7. Values with leading/trailing spaces, tabs, newlines, and non-ASCII (Chinese) text.
8. The program name shown in usage/errors (is it 'test13_executable'?).
Report the exact format strings so they can be reproduced character-for-character in JS,
including how the required-arguments error lists multiple missing args (comma separated? order?).`,
  },
  {
    key: 'paragraphs-headings',
    prompt: `AREA: paragraphs, ATX/setext headings, horizontal rules, line breaks, and top-level whitespace handling.
Probe through --a, --b and --c (they differ: --c has 'toc' which adds id attributes to headings!).
Establish:
1. Simple paragraph; multiple paragraphs separated by one blank line, by many blank lines.
2. Are output blocks separated by a blank line in the HTML? Show exact bytes for a two-paragraph doc.
3. Single newline inside a paragraph: is it preserved as a newline in the <p>?
4. Trailing two-or-more spaces at end of line -> <br />? exact form ('<br />' vs '<br>'). Also trailing backslash.
5. ATX headings h1..h6, and 7 hashes (#######). Heading with no space after # ('#Hello'). Closing hashes ('## Hi ##').
   Heading with trailing whitespace. Empty heading ('#', '##  ').
6. Setext headings: 'Title\\n=====' and 'Title\\n-----'. Single '=' / '-'. Underline shorter than title.
7. Horizontal rules: ---, ***, ___, - - -, ***** , with leading spaces (1,2,3,4 spaces). Exact output tag ('<hr />').
   A '---' immediately after a paragraph line (setext vs hr precedence).
8. Leading blank lines, trailing blank lines, whitespace-only input (' '), completely empty input ('').
   For empty input what is printed (an empty line?) - check with | cat -A.
9. Input with \\r\\n line endings and with tabs used for indentation.
10. For --c specifically: the exact 'id' slug produced by the toc extension for headings containing
    ASCII words, mixed case, punctuation, digits, spaces, and CHINESE characters (e.g. '# 标题1', '# Hello World',
    '# Hello, World!', '# A  B', '# --x--'). Test duplicate identical headings (id collision suffixing).
    Test whether a literal '[TOC]' line in --c produces a table of contents, and its exact markup.`,
  },
  {
    key: 'lists',
    prompt: `AREA: lists (ordered, unordered, nested) - the highest-risk area for a port.
Probe mainly through --a, spot-check --b/--c for differences.
Establish exact HTML (indentation of <li>, whether <li> content is wrapped in <p>):
1. Tight ul with -, *, + markers. Mixed markers in one list (does it split the list?).
2. Tight ol with '1. 2. 3.'; non-sequential numbers ('1. 3. 7.'); start != 1 (e.g. '3. x\\n4. y') -> does it emit start="3"?
   ')' delimiter ('1) x').
3. Loose lists (blank line between items) -> <p> wrapping. Show exact bytes.
4. Nested lists: 2-space, 3-space, 4-space indentation of the child marker. Show exact nesting/indentation of output.
   ul inside ol and ol inside ul.
5. Multi-paragraph list items; a code block inside a list item; a blockquote inside a list item.
6. A list immediately following a paragraph with no blank line (does it become a list?).
7. Lazy continuation lines (item text continued on next line without indentation).
8. Item with trailing spaces; empty list item ('- '); item containing only a nested list.
9. Marker followed by multiple spaces ('-   x'). Tab after marker.
10. Does a 4-space-indented first line become a code block instead of a list?
Report the exact newline/indent layout of nested output, e.g. whether it is
'<ul>\\n<li>a<ul>\\n<li>b</li>\\n</ul>\\n</li>\\n</ul>' or some other arrangement. This must be byte exact.`,
  },
  {
    key: 'inline-emphasis-code',
    prompt: `AREA: inline spans - emphasis, strong, code spans, escapes, entities.
Probe through --a (extra) and cross-check --b (plain+codehilite) for any difference.
Establish:
1. *em*, _em_, **strong**, __strong__, ***both***, ____ x ____, and nesting like **a *b* c**.
2. Intraword: 'a*b*c', 'a_b_c', 'snake_case_word', 'foo__bar__baz'. Which produce emphasis?
3. Unmatched/odd runs: '*a', 'a*', '**a*', '*a**', '****', '* not em *' (spaces inside).
4. Code spans: \`x\`, \`\`a \` b\`\`, \`\` \`x\` \`\`, code span containing <, >, &, *, _, and backslashes.
   Does leading/trailing single space get stripped inside a code span? Multiple spaces?
   Unclosed backtick. Backtick run length matching (\`\`\`x\`\`\` on one line).
5. Escapes: backslash before each of \\\\ \\\` \\* \\_ \\{ \\} \\[ \\] \\( \\) \\# \\+ \\- \\. \\! \\| \\< \\> \\& \\" \\' \\: \\~ \\^ \\=
   and backslash before a letter or a space or end of line. Show which characters are escapable.
6. Raw '&' handling: bare '&' -> '&amp;'? A valid entity '&amp;' '&copy;' '&#169;' '&#x1F600;' - preserved as-is?
   An invalid entity '&notanentity;' '&#;' '&amp x'.
7. Bare '<' and '>' in text -> '&lt;'/'&gt;'? '<3', 'a < b', '5 > 3'.
8. Double quotes and apostrophes: are they left alone or converted to entities?
9. Inline raw HTML: '<b>x</b>', '<span class="y">x</span>', '<br>', '<br/>', self-closing, unknown tag '<foo>',
   '<script>alert(1)</script>' inline in a paragraph.
10. Non-ASCII: does any output escaping happen for Chinese/emoji? Confirm UTF-8 passthrough.`,
  },
  {
    key: 'links-images-refs',
    prompt: `AREA: links, images, reference definitions, autolinks, footnotes, abbreviations.
Note: --a has 'extra' (which includes footnotes, abbr, attr_list, def_list); --b and --c do NOT.
Establish:
1. Inline link [t](url), with title [t](url "T") and single-quoted title, empty url [t](), url with spaces,
   url in angle brackets [t](<u rl>), url containing parentheses, url containing & and " (escaping in href).
2. Reference links: [t][id] + '\\n[id]: url "T"'; collapsed [t][]; shortcut [t]; case-insensitivity of id;
   definition indented; definition with title on next line. Does an unused definition print anything?
   Does a used definition leave any blank output/newline where it was?
3. Images: ![alt](src), with title, reference image. Exact attribute ORDER in output (src, alt, title?).
   Exact self-closing form ('<img ... />').
4. Autolinks: <http://example.com>, <https://a.b/c?d=e&f=g>, <mailto:x@y.com>, bare 'x@y.com' in angle brackets
   (is the email obfuscated into &#-entities? show exact output), bare URL not in brackets (linkified or not?).
5. Nested/edge: [a [b] c](u), [](u), [t](u) inside emphasis, link text containing code span or image.
6. footnotes (only --a): 'text[^1]\\n\\n[^1]: note' -> show the FULL exact output including the
   <div class="footnote"> block, hr, ol, li ids, backref anchor markup and attribute order.
7. abbr (only --a): 'HTML is fun\\n\\n*[HTML]: HyperText Markup Language' -> exact <abbr> output.
8. attr_list (only --a): '# Head {: #myid .cls }', 'para {: .x }', inline '*em*{: .y }' -> exact attribute output/order.
9. def_list (only --a): 'Term\\n:   Definition' -> exact <dl>/<dt>/<dd> output, tight and loose.
10. Cross-check: run the SAME footnote/abbr/def_list/attr_list input through --b and --c to show it is NOT processed.`,
  },
  {
    key: 'code-blocks-fences',
    prompt: `AREA: code blocks - indented, fenced, and the codehilite extension. This is the biggest cross-channel difference.
Channels: --a = extra (includes fenced_code) + tables, NO codehilite. --b = codehilite ONLY (no fenced_code).
--c = fenced_code + toc, NO codehilite. Combined pass = no extensions at all.
Establish, for EACH channel separately:
1. Indented (4-space) code block. Plain in --a/--c ('<pre><code>...') vs codehilite in --b
   ('<div class="codehilite"><pre><span></span><code>...'). Give exact bytes for both, including the
   trailing newline before </code> and whether there is a newline after '<code>'.
2. Indented code with more than 4 spaces, with tabs, with blank lines inside, with trailing blank lines.
   How much indentation is stripped? Are internal blank lines kept?
3. HTML-escaping inside code blocks: <, >, &, ", ' -> which become entities in each channel?
4. Fenced code with backticks: '\`\`\`\\ncode\\n\`\`\`'. Works in --a and --c; in --b (no fenced_code) what happens?
   Show all three.
5. Fenced with a language: '\`\`\`python\\nprint(1)\\n\`\`\`' -> exact class attribute(s) on <pre>/<code>.
   Try lang 'js', 'text', 'nonexistentlang', and uppercase 'Python'.
6. Tilde fences '~~~', longer fences, fence with trailing spaces, unclosed fence, fence inside a list item,
   fence containing backticks, fence containing markdown that must NOT be processed, empty fence.
7. Fenced code with attr_list style braces '\`\`\`{.python}' and '\`\`\`{: .python #id}' (attr_list is in extra -> --a).
8. codehilite specifics in --b: the shebang form '#!python' as the first line of an indented block,
   and the ':::python' colon form. Show exact output (does it add line numbers? a <table>? spans?).
   Does the pygments highlighting actually emit <span class="..."> tokens for python code, or plain text?
   Try a python snippet with keywords/strings/numbers/comments and REPORT THE EXACT SPAN MARKUP if any.
9. What does the COMBINED (no-extension) pass do to each of these outputs when re-parsed? In particular
   does '<div class="codehilite">' survive unchanged, and does '<pre><code>' survive unchanged?
10. Inline code span vs code block interaction; a line that is exactly 4 spaces; code block at the very start
    vs after a paragraph.`,
  },
  {
    key: 'tables-blockquotes',
    prompt: `AREA: tables (extension) and blockquotes.
--a has 'extra'+'tables' so tables work there. --b and --c do NOT have tables. Verify that.
Establish:
1. Minimal table: '| a | b |\\n|---|---|\\n| 1 | 2 |' -> exact full HTML bytes (<table>, <thead>, <tr>, <th>,
   <tbody>, <td>) with exact indentation and newlines. This must be byte exact.
2. Table without leading/trailing pipes. Table with alignment rows ':---', '---:', ':---:', mixed.
   Exact style attribute output (e.g. 'style="text-align: left;"') and its position in the tag.
3. Ragged rows (fewer/more cells than header). Empty cells. Cell containing inline markdown (*em*, code span, link).
   Cell containing an escaped pipe '\\|' and a pipe inside a code span.
4. A table not preceded by a blank line; a table immediately after a paragraph.
5. Same table input through --b and --c: show it renders as a paragraph instead, with exact escaping of '|'.
6. Blockquotes: '> a', multi-line, lazy continuation, nested '> > b', blockquote containing a list,
   a heading, a code block, a fenced block. '>' with no space, '>' alone, blank '>' lines separating paragraphs.
   Exact output layout ('<blockquote>\\n<p>a</p>\\n</blockquote>').
7. Blockquote in --c: does a heading inside a blockquote get a toc id?
8. Nested blockquote + list + code combinations, exact bytes.`,
  },
  {
    key: 'raw-html-blocks',
    prompt: `AREA: raw block-level HTML passthrough. This is CRITICAL because the 4th output re-parses HTML.
The combined pass is markdown.markdown(html1 + '\\n' + html2 + '\\n' + html3) with NO extensions.
Establish precisely how Python-Markdown treats block HTML:
1. Feed HTML directly as --a/--b/--c: '<p>hello</p>', '<div>x</div>', '<h1>t</h1>', '<ul>\\n<li>a</li>\\n</ul>',
   '<table>...</table>', '<pre><code>x</code></pre>', '<blockquote><p>q</p></blockquote>', '<hr />', '<br />'.
   Which pass through UNCHANGED? Which get wrapped in <p>? Which get their content markdown-processed?
2. Is markdown INSIDE a raw block element processed? e.g. '<div>\\n*em*\\n</div>' and '<p>*em*</p>'.
   Note --a has 'extra' which in modern Python-Markdown includes md_in_html - so --a may differ from --b/--c
   and from the combined pass. Compare all four for the same input.
3. Two adjacent HTML blocks separated by ONE newline (no blank line) - exactly the shape the combined pass sees:
   '<p>a</p>\\n<p>b</p>', '<h1>a</h1>\\n<p>b</p>', '<ol>\\n<li>x</li>\\n</ol>\\n<ul>\\n<li>y</li>\\n</ul>',
   '<div class="codehilite"><pre><span></span><code>x\\n</code></pre></div>\\n<p>b</p>'.
   Do they stay separate, merge, or get re-indented? Show exact bytes.
4. An unclosed tag '<div>x'; a stray '</div>'; a comment '<!-- c -->'; a processing instruction; '<!DOCTYPE html>';
   '<script>' block with markdown-ish content inside; '<style>' block.
5. Inline-level HTML at the start of a line ('<span>x</span>' alone) - wrapped in <p>?
6. HTML block followed immediately (no blank line) by markdown text, and markdown text followed by an HTML block.
7. Attributes with single quotes, unquoted, and boolean attributes - preserved verbatim?
8. Now the key end-to-end check: pick inputs whose html1/html2/html3 include the tricky shapes above and verify
   the 4th printed line equals what you predict. Report any case where the combined output is NOT simply
   html1 + '\\n' + html2 + '\\n' + html3.`,
  },
  {
    key: 'combined-endtoend',
    prompt: `AREA: end-to-end behavior of the whole program, focused on the 4th (combined) output and on print/newlines.
Establish:
1. For simple inputs, is the 4th output exactly html1+'\\n'+html2+'\\n'+html3? Find and report COUNTEREXAMPLES.
   Try hard to break it: inputs producing trailing blank lines, inputs producing raw text that is not HTML,
   inputs whose HTML output ends without a newline, inputs producing '&amp;' (does it become '&amp;amp;'?
   double-escaping in the second pass), inputs producing '<br />', inputs producing entities, inputs
   producing '<' or '>' escaped as '&lt;'/'&gt;' (do they get re-escaped?).
2. Does markdown output ever end with a newline? Use | cat -A on a single-channel probe to see the exact
   bytes of each printed line, so the JS port knows exactly how many newlines print() adds.
3. Empty/whitespace inputs: --a '' --b '' --c '' -> exact bytes of the whole stdout (| cat -A). Then combinations
   where only one is empty. How many blank lines appear?
4. Inputs that are plain text with no markdown, containing characters that get escaped in pass 1 and would be
   re-escaped in pass 2: '&', '<', '>', 'a & b', '1 < 2 > 0', '"quoted"', 'AT&T'. Show all four outputs.
5. An input that is itself HTML-escaped text, e.g. '&lt;p&gt;'.
6. Very long lines, and text containing literal backslashes.
7. Tabs in the input at various positions (tab expansion rules - are tabs converted to spaces?).
8. \\r\\n and lone \\r in input.
9. Confirm ordering of stdout writes and that nothing goes to stderr on success.
10. Report a table of 10+ (a,b,c) -> full stdout examples, chosen to be maximally diagnostic, that a JS port
    can be diffed against.`,
  },
  {
    key: 'toc-deep',
    prompt: `AREA: the 'toc' extension in depth (only active on --c) plus heading id slugification.
Establish, all via --c (use --a 'A' --b 'B'):
1. Default behavior: are ids added to ALL heading levels h1..h6? Setext headings too? Headings inside
   blockquotes / list items? Headings created by raw HTML ('<h1>x</h1>')?
2. The EXACT slugify algorithm, by testing many heading texts. Cover: 'Hello World' , 'Hello  World'
   (2 spaces), ' leading/trailing ', 'MiXeD CaSe', 'with-dash', 'with_underscore', 'with.dot',
   'punct!@#$%^&*()', 'a+b=c', 'quotes "x" and \\'y\\'', 'slash/back\\\\slash', 'colon:semi;', '中文标题',
   '标题1', 'Ünïcödé accents', 'emoji 😀 test', '123', '  ', '#', 'tab\\there', 'a—em dash',
   'Header with *emphasis*', 'Header with \`code\`', 'Header with [link](u)', 'Header with <b>html</b>',
   'Header with &amp; entity'. For each report the exact id produced. Deduce the rule (what is stripped,
   what is replaced with '-', case folding, unicode normalization/transliteration, empty result behavior).
3. Duplicate headings: two, three, four identical headings -> id suffix pattern ('_1'? '-1'?). Also
   a heading whose slug collides with an earlier different heading.
4. The '[TOC]' marker: exact generated markup (div class? ul/li nesting? anchor href?) for a document with
   h1/h2/h3 nesting, including skipped levels (h1 then h3). Case sensitivity of '[TOC]'. '[TOC]' inline in a
   paragraph vs on its own line. Multiple '[TOC]' markers.
5. Are permalinks/anchorlinks added by default? (expect no) Confirm.
6. Does toc affect anything other than headings? Does a heading with attr_list-style '{: #x }' keep that id
   (attr_list is NOT in --c)?
7. Interaction with fenced_code in --c: a '#' line inside a fence must NOT become a heading/id.
8. Cross-check the same headings through --a (extra, has attr_list but no toc) and --b to confirm NO ids there.`,
  },
]

phase('Probe')
const reports = await parallel(AREAS.map(area => () =>
  agent(PREAMBLE + '\n\n' + area.prompt, {
    label: `probe:${area.key}`,
    phase: 'Probe',
    agentType: 'general-purpose',
  }).then(text => ({ key: area.key, text }))
))

const good = reports.filter(Boolean)
log(`collected ${good.length}/${AREAS.length} probe reports`)

return {
  reports: good,
}
