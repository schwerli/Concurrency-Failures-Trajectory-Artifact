export const meta = {
  name: 'probe-python-markdown',
  description: 'Black-box probe Python-Markdown subsystems via the test6 executable and write exact behavioral specs',
  phases: [
    { title: 'Probe', detail: 'one agent per markdown subsystem, probing the executable' },
    { title: 'Refute', detail: 'adversarial counterexample hunt against each spec' },
    { title: 'Refine', detail: 'fold counterexamples back into the spec' },
  ],
}

const HARNESS = `
## Tools available to you

The reference implementation is a PyInstaller binary of this Python program (Python-Markdown 3.x, NO extensions, default XHTML output):

    html1 = markdown.markdown(args.a); html2 = markdown.markdown(args.b)
    print(html1); print(html2)

Probe it with the harness (NEVER use the \`python\` command; it does not exist):

1. Write a JSONL file where each line is a JSON string (the markdown input) OR a JSON object {"label": "...", "text": "..."}:
       /workspace/harness/cases/<YOURFILE>.jsonl
   JSON escapes let you express newlines/tabs/unicode precisely. Example line:
       "- a\\n  cont\\n- b"
2. Run:  node /workspace/harness/probe.mjs /workspace/harness/cases/<YOURFILE>.jsonl
   It prints, per case:  IN <json-of-input>  and  OUT <json-of-exact-html-output>.
   A case whose text starts with '-' will be rejected by argparse (RC 2) - that is expected; to probe
   such text you must call the binary directly: /workspace/dataset/test6_executable --a=--- --b X

Each probe run costs ~0.5s per case. Batch 40-120 cases per file. Run MANY batches - iterate: form a
hypothesis about the parsing rule, write cases that would falsify it, run, revise. Do not stop at one batch.
You should run at least 5 batches and 250+ total cases.

## Hard rules
- Do NOT create, edit, or read anything in /output. Do NOT write any implementation code.
- Do NOT try to install packages or find Python-Markdown source. It is a black box. Only observe behavior.
- Your ONLY deliverables are the two files named below.
`;

const DELIVERABLE = (n, slug) => `
## Deliverables

1. Write \`/workspace/spec/${n}-${slug}.md\` - a precise, implementation-ready behavioral specification:
   - Numbered RULES stated as algorithms an implementer can follow deterministically (order of operations,
     precedence, what wins on ambiguity, exact whitespace/newline placement in output).
   - An EVIDENCE table of input->output pairs in JSON-escaped form for every rule.
   - A SURPRISES section: behaviors that would not be guessed from the CommonMark or classic-Markdown spec.
   - An UNCERTAIN section: anything you could not pin down.
   Be exhaustive and concrete. The implementer cannot see the binary's source and will rely only on your doc.
2. Leave your accumulated regression cases in \`/workspace/harness/cases/${n}-${slug}.jsonl\` (merge all your
   batches into this one file; exclude cases that error out under argparse).

Return a <=250 word summary of the most load-bearing / surprising rules you established.
`;

const AREAS = [
  { n: '01', slug: 'blocks-and-preprocessing', title: 'Document preprocessing and block splitting', focus: `
- How the input is normalized before parsing: tab handling (a tab equals how many spaces? is it position-aware or a plain replacement?), \\r\\n and \\r line endings, trailing/leading blank lines, whitespace-only lines, form feed / vertical tab / NBSP / unicode spaces, U+2028.
- How the document is split into top-level blocks (what exactly counts as a block separator: one blank line? a line of only spaces? a line of only tabs?).
- Empty input, input of only whitespace, input of only newlines - what is printed (remember print() adds a trailing newline; distinguish '' from '\\n').
- Paragraph handling: leading spaces on a paragraph's first vs later lines (1,2,3 spaces), trailing spaces/tabs on lines, internal blank-ish lines, very long lines.
- The exact final-newline behavior of the returned HTML string and how top-level blocks are joined.
- Indented (4-space) code blocks: entity/HTML escaping inside, blank lines inside the block, lines with 5+ spaces, tab-indented, trailing blank lines, what terminates the block, mixed tab/space indent.` },
  { n: '02', slug: 'raw-html-blocks', title: 'Block-level raw HTML (the html stash)', focus: `
- Which top-level constructs are pulled out as raw HTML and passed through untouched vs. wrapped in <p>.
- Exactly which tag names are treated as block-level (probe a wide set: div, p, table, ul, li, span, em, section, article, custom-tag, DIV uppercase, h1, pre, form, fieldset, dl, blockquote, hr, br, img, input, iframe, script, style, canvas, video, details, summary, math, svg, unknown-tag).
- Blank lines inside a raw HTML block; unclosed tags; mismatched closing tags; self-closing tags; attributes with > or quoted strings containing >; multi-line attributes.
- The EXACT blank lines / newlines that appear around a stashed HTML block in the output (e.g. is there an extra \\n\\n after it? does it differ when it is first/last/middle of the document?).
- Text before/after a raw HTML block on adjacent lines and on the same line.
- HTML comments <!-- -->, processing instructions <? ?>, declarations <!DOCTYPE>, CDATA, all in block and inline positions; comments containing -- or blank lines.
- Raw HTML nested inside list items and blockquotes.
- <script>/<style> bodies containing markdown characters.` },
  { n: '03', slug: 'headers-hr', title: 'ATX headers, setext headers, horizontal rules', focus: `
- ATX: 1..7+ hashes, no space after hashes, many spaces, leading 1/2/3/4 spaces before the hashes, trailing hashes (matched and unmatched counts), hashes only ('#', '##'), '# ' empty header, escaped \\# at start, header text containing #, header immediately after/before a paragraph with no blank line, inline markup inside headers, trailing whitespace.
- Setext: '=' and '-' underlines of length 1,2,3,many; underline with leading/trailing spaces; underline indented; multi-line paragraph followed by underline (which lines become the heading?); setext on a line following a list or blockquote; '-' underline vs HR vs list ambiguity; a setext underline made of '=' after an empty line.
- HR: ---, ***, ___, with spaces between characters, 3 vs 2 vs 4+ characters, leading 1-3 spaces, trailing spaces, mixed characters, HR directly adjacent to text lines above/below, HR inside list items and blockquotes, '- - -' vs '- -'.
  NOTE: inputs starting with '-' need the =-form: /workspace/dataset/test6_executable --a=--- --b X
- The interaction/precedence order between setext-'-', HR, and unordered lists.` },
  { n: '04', slug: 'lists', title: 'Lists (ordered, unordered, nesting, loose vs tight)', focus: `
This is the most intricate area. Determine the exact indentation and sibling rules.
- Markers: -, *, +, mixed markers in one list (does a marker change start a new list?); ordered markers '1.', '1)', '01.', '0.', '999.'; do the numbers in the output <ol> matter (is a start= attribute ever emitted?).
- Tight vs loose: when does <li> content get wrapped in <p>? Blank line between items, blank line inside one item, blank line before the first item, blank line at the end. Does one loose item make the whole list loose?
- Continuation lines: 0,1,2,3,4,5,6,8 spaces of indent on a continuation line; does the output PRESERVE the original leading spaces of continuation lines (probe '- a\\n  cont')? What about with tabs?
- Nesting: how much indent creates a sublist (2? 3? 4? 5?); deep nesting; skipping a level (0 then 8 spaces); sublist under a loose parent; the exact newline placement of nested <ul>/<ol> in the output (e.g. '<li>a<ul>' on one line).
- A list interrupting a paragraph with no blank line; a paragraph after a list with no blank line; two lists separated by a blank line; a list separated by a blank line then a differently-marked list.
- Indented code inside list items (how many spaces needed?), fenced-looking text, blockquotes inside items, headers inside items, HR inside a list.
- '1. a' vs '1.a' vs '1.  a'; '-' with no text; '- ' with trailing space only.
- Ordered list whose first number is not 1.` },
  { n: '05', slug: 'blockquotes', title: 'Blockquotes', focus: `
- '>' with and without a following space; '>' with 2+ spaces; leading 1/2/3/4 spaces before '>'.
- Lazy continuation (a plain line after a quoted line): when is it absorbed, when not?
- Blank '>' lines; a blank line inside a quote; two quotes separated by a blank line vs by a blank '>' line.
- Nesting '> >', '>>', '> > >'; un-nesting mid-quote.
- Blockquotes containing: headers, HRs, lists, indented code, raw HTML, other blockquotes.
- Blockquotes inside list items; lists inside blockquotes.
- A '>' line immediately after a paragraph line with no blank line.
- The exact newline placement in the output <blockquote> ... </blockquote> structure.
- A line that is only '>'; a line that is '> ' with trailing space.` },
  { n: '06', slug: 'emphasis', title: 'Emphasis and strong emphasis (the hardest inline area)', focus: `
Pin down the exact em/strong matching rules. Python-Markdown does NOT follow CommonMark here.
- Single/double/triple asterisks and underscores, in every combination: *a*, **a**, ***a***, ****a****, *****a*****, _a_, __a__, ___a___, ____a____.
- Intraword: a*b*c, a**b**c, a_b_c, a__b__c, snake_case, my_var_name, 2*3*4, foo*bar*baz.
- Unmatched / unbalanced: *a, a*, **a*, *a**, ***a*, *a***, **a b, *a _b* c_.
- Nesting: *a **b** c*, **a *b* c**, *a *b* c*, __a _b_ c__, ***a* b**, **a *b***, *__a__*, __*a*__.
- Mixed delimiters: *a_b_c*, _a*b*c_, **a__b__c**.
- Whitespace adjacency: '* a*', '*a *', '** a **', '*  a  *'.
- Escaped delimiters: \\*a\\*, \\**a**, *a\\*, \\*\\*a\\*\\*.
- Delimiters adjacent to punctuation: (*a*), "*a*", *a*., ,*a*, a-*b*-c, *a*'s.
- Emphasis spanning a newline: '*a\\nb*'. Emphasis containing code spans, links, images, raw HTML.
- Emphasis inside/around links: [*a*](b), *[a](b)*, [a](b*c*d).
- Adjacent runs: *a**b*, *a*b*c*, **a**b**c**, *a* *b*, *a*_b_.
- The ORDER in which the em/strong patterns are attempted matters - state which pattern wins for each ambiguous case.` },
  { n: '07', slug: 'code-escapes-entities', title: 'Code spans, backslash escapes, entities, autolinks, line breaks', focus: `
- Code spans: 1,2,3,4 backticks; unmatched backticks; backticks with leading/trailing spaces inside; '\` a \`'; '\`\`  \`\`'; empty '\`\`'; code containing <, >, &, quotes, entities (&amp;), markdown chars, backslashes, newlines; code spanning multiple lines; code spans inside emphasis/links/headers; a backtick run of different length inside.
- Backslash escapes: which characters are escapable (probe ALL ASCII punctuation, plus letters, digits, space, newline, backslash itself)? What does a backslash before a non-escapable char produce? '\\\\' then '*'? Escapes inside code spans, inside link URLs and titles, inside raw HTML.
- Entities: named (&amp; &copy; &nbsp; &Alpha; &fake;), numeric decimal (&#65; &#0; &#x41;), hex, malformed (&#; &# ; &amp without semicolon; & followed by space/letter/digit). Which are passed through and which get their & escaped to &amp;?
- Bare '<' and '>' and '&' in text; '&' inside link URLs and inside titles and inside attribute values.
- Autolinks: <http://...>, <https://...>, <ftp://...>, <mailto:x@y>, <x@y.com>, <www.x.com>, <foo>, <a b>, angle brackets containing spaces or markdown; bare URLs (are they linkified?).
- Email obfuscation: pin down the EXACT character-by-character encoding scheme for <foo@bar.com> - which characters become &#NN; decimal vs &#xNN; hex vs literal, and whether it is deterministic across runs (run the same input 3+ times to check).
- Line breaks: 2 trailing spaces, 1 trailing space, 3+ trailing spaces, trailing tab, trailing spaces on the last line of a paragraph, trailing spaces before a blank line, backslash at end of line.` },
  { n: '08', slug: 'links-images-refs', title: 'Inline links, images, and reference definitions', focus: `
- Inline links: [t](url), empty url [t](), url with spaces, url in <>, url with parens (balanced and unbalanced), url with escaped parens, titles in "..." and '...' and (...), title containing quotes/escapes, whitespace variants between url and title, newlines inside the link, [t]( url ), missing closing paren, nested brackets in the text [a[b]c](u), empty text [](u), text containing markdown/code/images.
- Images: ![alt](url), same variants; ![](u); alt text containing markdown, quotes, brackets; nested image in link text.
- Reference links: [t][ref], [t][], [ref] (shortcut), case-insensitivity of the label, label with spaces/newlines/punctuation, undefined reference (exact output), reference defined AFTER use, duplicate definitions (which wins?).
- Reference definitions: leading 0-4 spaces, 'label:' forms, url in <>, title on the same line vs the next line, title in ", ', or (), multiple definitions in one block, a definition inside a paragraph (mid-block), a definition inside a list item or blockquote, a definition that is the only content (what is printed?), a definition immediately followed by a paragraph with no blank line.
- Image reference syntax ![t][ref] and ![ref].
- The exact attribute ORDER and quoting in the emitted <a> and <img> tags, and how special characters in urls/titles/alt are escaped (probe ", ', <, >, &, unicode, spaces).` },
  { n: '09', slug: 'inline-html-and-serialization', title: 'Inline raw HTML, output serialization, and prettifying', focus: `
- Inline raw HTML inside paragraphs: <span>, <b>, <br>, <br/>, <br />, <img src=x>, <a href="x">, unknown tags, uppercase tags, tags with attributes containing >, quotes, unicode, newlines inside a tag, unclosed '<', a lone '<' followed by a letter, '<3', 'a < b', '<-', tags with markdown inside them, an inline tag whose content contains a code span or emphasis.
- Is inline HTML output verbatim, or normalized (attribute order, quote style, self-closing slash)?
- Markdown inside inline HTML: does *em* inside <span> get converted? What about inside <code>, <pre>, <script>, <style>, <a>?
- Void/empty element serialization: which tags are written as '<x />' vs '<x></x>' (probe by producing hr, br, img).
- Attribute value escaping in output for generated elements (&, <, >, ", ' in urls, titles, alt).
- The 'prettify' step: exactly where newlines are inserted around block-level elements in the output; the trailing newline of the whole document; newlines inside <pre><code>; empty block elements; nested block elements.
- The AMP_SUBSTITUTE / '&' round-trip: does '&' inside a generated href become '&amp;'? What about '&amp;' in the source url? '&copy;' in a url? A url that is exactly '&'.
- Whether stray placeholder text (like STX/ETX control chars or 'wzxhzdk') can ever leak into the output - try inputs containing those literal strings, and literal U+0002/U+0003 characters.` },
  { n: '10', slug: 'argparse-cli', title: 'argparse command-line fidelity', focus: `
Probe the binary DIRECTLY (not through the harness) to characterize its CLI exactly:
    /workspace/dataset/test6_executable [args...]
Capture stdout, stderr, and exit code separately for each. Use a node script with spawnSync and an argv
array so you control bytes exactly (avoid shell quoting problems). Cover:
- --help and -h (exact text, byte for byte, including the 'usage:' line, blank lines, and 'options:' heading), exit code, and whether it goes to stdout or stderr.
- No args; only --a; only --b; both; extra positional args; unknown option --c; -x.
- '--a=value' and '--b=value' forms; '--a=' (empty value); '--a' with empty-string value; '--a' as the last arg with no value.
- Values that look like options: '--a' '-x', '--a' '---', '--a' '-1', '--a' '-1.5', '--a' '- x' (with a space), '--a' '--b'.
- Abbreviations/prefix matching: does '--' alone work as a separator? What about a single-dash '-a'? Ambiguous prefixes?
- Repeating an option: '--a 1 --a 2' (which value wins?).
- Argument ORDER: '--b x --a y'.
- Values with newlines, tabs, unicode, emoji, NUL-adjacent bytes, very long values (100KB).
- The exact stderr message text and exit code for every error case (note: the program name in messages).
- What is printed when both values are empty strings.
Write the exact expected stdout/stderr/exit-code for each case so an implementer can reproduce them byte for byte.` },
];

phase('Probe')

const specs = await pipeline(
  AREAS,
  (area) => agent(
    `You are black-box reverse-engineering the behavior of Python-Markdown (as reached through a compiled ` +
    `executable) so a colleague can reimplement it exactly in JavaScript.\n\n` +
    `# Your assigned area: ${area.title}\n\nInvestigate specifically:\n${area.focus}\n` +
    HARNESS + DELIVERABLE(area.n, area.slug),
    { label: `probe:${area.slug}`, phase: 'Probe' }
  ),
  // Adversarial pass: try to break the spec that was just written.
  (summary, area) => agent(
    `A colleague probed the compiled Python-Markdown executable and wrote a behavioral spec at ` +
    `\`/workspace/spec/${area.n}-${area.slug}.md\` covering: ${area.title}.\n\n` +
    `Your job is ADVERSARIAL: read that spec, then try hard to FALSIFY its rules. For each rule, construct ` +
    `inputs that the rule predicts one way and that you suspect the binary handles differently - especially ` +
    `combinations, boundary indentation, interactions with other constructs, and cases the spec's own ` +
    `UNCERTAIN section admits. Also look for rules that are stated too vaguely to implement deterministically.\n\n` +
    `Their probe summary was:\n${summary}\n` + HARNESS +
    `\n## Deliverables\n` +
    `1. Write \`/workspace/spec/${area.n}-${area.slug}-counterexamples.md\`: every input where the binary's ` +
    `actual output contradicts or is not determined by the spec. Give input (JSON-escaped), what the spec ` +
    `predicts, actual output, and the corrected rule.\n` +
    `2. Append your cases to \`/workspace/harness/cases/${area.n}-${area.slug}.jsonl\` (append, do not truncate ` +
    `the existing content).\n` +
    `Run at least 150 new probe cases. Return a <=200 word list of the contradictions you found.`,
    { label: `refute:${area.slug}`, phase: 'Refute' }
  ),
  // Fold corrections back into a single authoritative spec.
  (refutation, area) => agent(
    `Read \`/workspace/spec/${area.n}-${area.slug}.md\` and \`/workspace/spec/${area.n}-${area.slug}-counterexamples.md\`.\n` +
    `Produce a single authoritative, self-contained, implementation-ready spec by REWRITING ` +
    `\`/workspace/spec/${area.n}-${area.slug}.md\` so that it folds in every correction from the ` +
    `counterexamples file and removes anything now known to be wrong. Keep it concrete: numbered rules, ` +
    `exact JSON-escaped evidence, explicit statements about whitespace and newline placement in the output. ` +
    `Where behavior is still unknown, say so plainly under UNCERTAIN rather than guessing.\n` +
    `You may run more probes to settle disagreements between the two documents (see harness instructions).\n` +
    HARNESS +
    `\nReturn a <=200 word summary of the FINAL rules an implementer most needs to know for this area.`,
    { label: `refine:${area.slug}`, phase: 'Refine' }
  )
)

return { areas: AREAS.map(a => `${a.n}-${a.slug}`), specs }
