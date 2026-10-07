export const meta = {
  name: 'crowbook-explore',
  description: 'Exhaustively probe the reference crowbook binary and write structured behavioral specs',
  phases: [
    { title: 'Probe', detail: 'parallel explorers, one per behavioral facet' },
    { title: 'Critic', detail: 'completeness critics find gaps' },
  ],
}

const RULES = `
CRITICAL RULES (violating these fails the whole benchmark):
- The reference binary is /tmp/ref/crowbook (a copy of /workspace/executable). It is crowbook 0.17.0.
- You MUST NOT decompile, disassemble, objdump, nm, strings, strace, ltrace, or otherwise statically
  analyze the binary. Interact ONLY through its CLI / stdin / stdout / generated files.
- You MUST NOT search the internet or any package registry for crowbook source code, nor read any
  crowbook source you might find on disk. No 'cargo add crowbook', no git clone, no pip/apt.
- There is NO network access anyway. Do not waste time trying.
- Work in your own scratch directory under /tmp/work/ (mkdir -p it, use a unique subdir name).
- 'strings' on the binary is FORBIDDEN. Only run it and read its output/generated files.

Tools available: bash, python3, rust. 'file', 'zip', 'unzip', 'xelatex' are NOT installed
(use python3 zipfile to inspect .epub archives).

Reference templates already dumped for you (do not re-dump unless needed):
/tmp/tpl/{html.css,epub.css,html.standalone.template,tex.template,epub.chapter.xhtml,
epub.titlepage.xhtml,html.dir.template,html.css.colors,html.js,html.css.print,
html.highlight.js,html.highlight.css,html.standalone.js}

GOAL: We are writing a from-scratch reimplementation of crowbook in Rust with ZERO external crates.
Your job is pure behavioral reverse engineering by observation. Be exhaustive and precise:
byte-level exactness matters (whitespace, newlines, attribute spacing, ordering).

OUTPUT: Write your findings as a detailed markdown spec to the file path given below.
Include exact literal input/output samples in fenced code blocks. Prefer showing raw bytes
(cat -A / python repr) when whitespace matters. Be long and complete: this file is the
implementation spec, another engineer will code from it WITHOUT access to the binary.
Also return a <=2000 char summary of the most important discoveries as your final message.
`

const FACETS = [
  {
    key: 'cli',
    file: '/tmp/explore/01-cli.md',
    prompt: `Facet: COMMAND LINE INTERFACE.
Determine exactly:
- Full --help output (byte exact) and -h, and what goes to stdout vs stderr, and exit codes.
- --version / -V output.
- Behaviour with no arguments at all; with a nonexistent file; with a directory.
- Every flag: -f/--force-emoji, -s/--single, -n/--no-fancy, -v/--verbose, -a/--autograph,
  -q/--quiet, -c/--create, -o/--output, -t/--to, --set, -l/--list-options, -L/--lang,
  --print-template, -S/--stats, -h, -V. For each: what it does, what errors it produces,
  exit code, and whether it needs BOOK positional arg.
- Argument errors: unknown flag, missing value, conflicting combos (e.g. --to without --output,
  --output without --to, --single with --create, etc). Capture exact error text.
- Order of the "CROWBOOK 0.17.0" banner line, which stream it goes to, and when it is suppressed
  (e.g. --quiet). Test with stdout/stderr redirected separately.
- -t/--to accepted values (html, epub, pdf, tex, html.dir, odt, proofread.*, ...?) and invalid value error.
- -o with -t html to a file and to '-' (stdout?).
- --create: exact generated book file content, with and without existing files, with -o, and what
  it writes to stdout/stderr; behavior when the file already exists.
- --stats / -S output format for various books (needs a book).
- -L/--lang: which language codes change messages; show the localized banner/messages for each
  (try en, fr, es, de, it, pt, nl, ru, ja, zh, sv, pl, cs, uk, ...). Record which ones actually differ.
- Does it read the LANG/LC_ALL env var to pick UI language? Test LANG=fr_FR.UTF-8 etc.
- --print-template: enumerate EVERY valid template name (probe systematically from the option list
  entries of type 'template path', plus html.css.colors, html.js, etc). Record the invalid-name error.
- Whether options can be given as --set key value pairs and the exact error for unknown keys/bad values.`,
  },
  {
    key: 'config',
    file: '/tmp/explore/02-config.md',
    prompt: `Facet: BOOK CONFIGURATION FILE FORMAT and chapter list semantics.
Determine exactly:
- Overall syntax: 'key: value' options; comment lines (#); blank lines; indentation tolerance.
- Chapter-list line prefixes. Known: '+ file.md' (numbered chapter). Discover ALL of them by
  experiment, e.g. '-', '!', '@', '*', digits like '4. file.md', '- file.md'. For each determine
  the semantics (numbered / unnumbered / hidden / part / explicit number / etc) by looking at the
  rendered HTML TOC and headings.
- What happens with a bare filename with no prefix; with a missing file; with an unreadable file.
- Multi-line / quoted values; values with ':' inside; trailing whitespace; 'true'/'false'/'yes'/'no'
  for booleans; integer parse errors; list-of-strings parsing (whitespace separated? quoted?).
- Unknown option key -> exact error/warning. Deprecated/renamed options (test output.odt, output.proofread.html,
  html.top, nb_char, numbering, autoclean, etc.) -> exact deprecation messages.
- 'import' option: how another book config is merged, relative path resolution, ordering/precedence.
- Options given as metadata: are values markdown-rendered? Test title with markdown/quotes/accents.
- YAML blocks in markdown files (input.yaml_blocks true/false): --- delimited blocks at the start and
  in the middle of files; what keys are honored; error messages.
- --single mode: metadata block at top of md file, how the title/chapters are derived, numbering.
- Exact wording of every error/warning produced by malformed config, including line numbers if any.
- Precedence: config file vs --set vs -o/-t.
- output.base_path, resources.base_path* effects on where files are read/written.
- 'output' list option (e.g. 'output: [html, epub]' or 'output: html epub') and how default filenames
  are derived from the book file name.`,
  },
  {
    key: 'md-block',
    file: '/tmp/explore/03-md-block.md',
    prompt: `Facet: MARKDOWN BLOCK-LEVEL PARSING, observed through HTML output.
Use a book with a single chapter and render to HTML (output.html), then extract only the
<div id = "chapter-0"> ... </div> region so you see the rendered body markup byte-exactly.
Systematically test and record the exact HTML produced for:
- Paragraphs, multiple blank lines, trailing spaces, hard line breaks (two spaces, backslash).
- ATX headings h1..h6 (and 7 hashes), closing hashes, setext headings (=== and ---).
- Note: the FIRST heading of a chapter is special (chapter title). Test headings at all levels,
  and what happens when a chapter does not start with a heading.
- Unordered lists (-, *, +), ordered lists (1. / 1) / starting at other numbers), nesting,
  tight vs loose lists, lists containing paragraphs/code/nested lists, task lists ([ ] / [x]).
- Fenced code blocks (\`\`\` and ~~~) with and without a language tag; indented code blocks;
  code block content escaping. Also with rendering.highlight set to none / highlight.js / syntect.
- Blockquotes, nested blockquotes, lazy continuation, blockquotes containing lists/code.
- Thematic breaks (---, ***, ___) - crowbook renders a special "rule".
- Tables (GFM pipe tables) with alignment colons, header-only, ragged rows; the surrounding
  <div class="table"> markup.
- Footnote definitions [^1]: ... and references; ordering; multiple paragraphs in a footnote;
  where footnotes get rendered in HTML (end of chapter markup) and their exact ids/classes.
- Raw HTML blocks and inline HTML with crowbook.html_as_text true and false.
- Paragraph ids: note <p id = "para-1">. Work out exactly how para ids are numbered/assigned
  (do they reset per chapter? do they count only paragraphs? what about paragraphs in lists,
  blockquotes, footnotes, tables?).
Record every exact output.`,
  },
  {
    key: 'md-inline',
    file: '/tmp/explore/04-md-inline.md',
    prompt: `Facet: MARKDOWN INLINE PARSING, observed through HTML output (single chapter, output.html).
Set input.clean: false where needed so typography does not confuse you, and also record the
input.clean: true behavior separately.
Test and record exact HTML for:
- *em*, _em_, **strong**, __strong__, ***both***, intraword underscores, unmatched delimiters.
- \`code\`, \`\`code with backtick\`\`, code containing < > & " '.
- ~~strikethrough~~ (is it supported? exact markup).
- superscript foo^up^ and subscript bar~down~ with crowbook.markdown.superscript true and false.
- Links: [text](url), [text](url "title"), reference links [text][ref] with [ref]: def,
  autolinks <http://...>, bare URLs, links to local .md files (do they get rewritten?),
  mailto, relative links, anchors (#foo). Record exact <a> markup and attribute order/spacing.
- Images: ![alt](src), image alone in a paragraph (standalone image markup) vs inline image,
  image with title, image path resolution (resources.base_path.images).
- Escapes: backslash before punctuation; character references (&amp; &#65; &copy;); literal < > &.
- Emphasis inside words, links inside emphasis, nesting combinations.
- Footnote references: exact anchor/id markup, numbering, html.side_notes true/false.
- Hard breaks and soft breaks inside emphasis/links.
- What happens with unsupported/unknown syntax (e.g. ==highlight==, :emoji:, {attrs}).
- Emoji handling and the -f/--force-emoji flag effect on output.`,
  },
  {
    key: 'typography',
    file: '/tmp/explore/05-typography.md',
    prompt: `Facet: TYPOGRAPHIC CLEANING (input.clean and friends). This is crowbook's signature feature.
The relevant options: input.clean (default true), input.clean.smart_quotes (true),
input.clean.ligature.dashes (false), input.clean.ligature.guillemets (false), and lang.
Determine EXACTLY, byte by byte (use python3 to print repr of the output so you see which exact
unicode codepoints are produced: U+00A0 NBSP, U+202F NARROW NBSP, U+2019 RIGHT SINGLE QUOTE, etc):
- For lang: fr (and fr_FR): what happens around : ; ! ? « » and before/after guillemets,
  inside numbers, with ellipsis, with dashes/em-dashes, with footnote markers. Which character
  (NBSP vs NARROW NBSP) is inserted where. Test many sentences.
- For lang: en (default): what cleaning happens (ellipsis? quotes? dashes? spaces before ; :?).
- Other langs to test: es, de, it, pt, ru, ja, zh, nl, sv, pl, eo. Record which langs have
  special rules and what they are.
- input.clean.smart_quotes: ' -> apostrophe/quote rules, "..." -> curly quotes, nested quotes,
  quotes at word boundaries, quotes after digits (feet/inches?), quotes in code spans (must not
  be cleaned), quotes in URLs/links.
- input.clean.ligature.dashes: -- and --- conversions; interaction with other rules.
- input.clean.ligature.guillemets: << and >> conversions.
- Where cleaning is NOT applied: code spans, code blocks, raw HTML, URLs, metadata?
  Test whether title/author metadata is cleaned.
- html.escape_nb_spaces / epub.escape_nb_spaces / tex.escape_nb_spaces: exact markup produced
  for NBSP and NARROW NBSP in each format (e.g. <span class="nnbsp">&#8239;</span>?) when true and
  when false. Get this byte-exact for html, epub and tex output.
Provide a precise algorithmic description (a state machine / rule list) sufficient to reimplement.`,
  },
  {
    key: 'html-struct',
    file: '/tmp/explore/06-html-structure.md',
    prompt: `Facet: HTML RENDERING STRUCTURE, TOC, numbering, parts.
Build multi-chapter books and record byte-exact HTML (output.html standalone).
Determine:
- TOC generation: exact <ul>/<li>/<a> markup, nesting for h1..h6, when TOC is shown (has_toc),
  the effect of rendering.num_depth 0..6, rendering.inline_toc, rendering.inline_toc.name.
- Chapter numbering: '+' numbered chapters, unnumbered chapters, explicit numbers,
  rendering.chapter.template, rendering.chapter (name), rendering.chapter.roman_numerals.
- Parts: how to declare a part in the book config, rendering.part, rendering.part.template,
  rendering.part.roman_numerals, rendering.part.reset_counter. Exact html.part.template rendering.
- html.chapter.template variable set: link, has_number, header, number, has_title, title.
  Test custom templates and record which variables exist (try invalid ones and record errors).
- Header/footer: html.header and html.footer (are they templates? markdown? which variables?).
- html.standalone.one_chapter: exact resulting markup/JS differences.
- html.icon (favicon markup), html.css.add, html.js, html.css custom paths.
- The JSON-LD <script type='application/ld+json'> block: exactly which metadata fields appear,
  and the exact whitespace when fields are unset (there were blank lines).
- html.side_notes.
- rendering.initials (lettrines) markup.
- Multi-file HTML (output.html.dir): full list of files created, index.html contents, per-chapter
  files naming scheme, prev/next chapter markup and localized strings, copied assets
  (stylesheet.css, print.css, menu.svg, book.svg, favicon, highlight.js/css when enabled).
  Include the exact bytes of menu.svg and book.svg (base64 them into your notes if binary,
  or copy them to /tmp/explore/assets/).
- Where images/resources get copied and how links are rewritten in html.dir.
- Also record what 'output.html' vs 'output.html.dir' vs -t html.dir do.`,
  },
  {
    key: 'epub',
    file: '/tmp/explore/07-epub.md',
    prompt: `Facet: EPUB OUTPUT. Use python3 zipfile to inspect generated .epub files.
Determine:
- Exact zip entry order, compression methods per entry (mimetype stored?), and any extra fields.
- epub.version 2 vs 3: differences in content.opf, toc.ncx, nav.xhtml, existence of nav,
  metadata elements, guide section, epub:type attributes.
- Full byte-exact content of content.opf, toc.ncx, nav.xhtml, title_page.xhtml, chapter_NNN.xhtml
  for a book with several chapters, parts, cover, subtitle, author, description, subject, license,
  version, date, autograph, and multiple languages.
- The uuid and dcterms:modified are nondeterministic: note their exact format.
- epub.toc.extras true/false differences.
- cover: how the cover image is added (manifest item id/properties, cover.xhtml? guide entry?),
  and what happens for epub2 vs epub3.
- resources.files / resources.out_path: where files land inside the epub, manifest entries,
  media types for various extensions (png, jpg, svg, ttf, otf, woff, css, js, unknown).
- Chapter file naming when there are >999 chapters? (just note the scheme), and for parts.
- epub.css / epub.css.add, epub.chapter.xhtml / epub.titlepage.xhtml custom templates.
- Footnotes in epub, html.side_notes in epub, epub.escape_nb_spaces.
- The warning 'Could not run zip command, falling back to zip library': when does it appear
  (crowbook.zip.command), what does setting crowbook.zip.command to a nonexistent command do,
  and is the resulting file identical either way? Record exact warning text.
- Whether an epub with the same input is byte-identical between runs apart from uuid/date.`,
  },
  {
    key: 'latex',
    file: '/tmp/explore/08-latex.md',
    prompt: `Facet: LATEX / PDF OUTPUT. xelatex is NOT installed, so use output.tex (or -t tex) to get
the generated .tex file. Determine byte-exactly:
- Full .tex output for a minimal book, and how each markdown element maps to LaTeX
  (paragraphs, headings at each level for numbered/unnumbered chapters and parts, emphasis,
  strong, code, code blocks with and without syntax highlighting, lists ordered/unordered/nested,
  task lists, blockquotes, rules, tables incl. column spec generation, images standalone vs inline,
  links with tex.links_as_footnotes true/false and tex.pageref_template, footnotes,
  strikethrough, superscript/subscript, hard breaks).
- LaTeX escaping rules for special chars: \\ { } $ & # % _ ~ ^ < > | " ' and unicode
  (e.g. curly quotes, nbsp, narrow nbsp with tex.escape_nb_spaces true/false).
- The template variable values: which <# if #> flags are set when (xelatex, book, stdpage,
  use_cover, initials, use_codeblocks, use_images, use_tables, use_strikethrough, use_taskitem,
  has_tex_size, tex_title, inline_toc, chapter_name, part_name, has_autograph, has_version,
  has_license, has_author, has_date), and the values of tex_lang for many lang codes,
  papersize, margins defaults for class=book vs article vs other, tex_size.
- tex.class variants (book, article, report, memoir): what changes in output (\\chapter vs \\section...).
- tex.stdpage, tex.title, tex.hyperref, tex.font.size, tex.margin.*, tex.paper.size,
  tex.template.add, tex.cover.
- What the 'pdf' output does when xelatex is missing: exact error text and exit code; whether
  a .tex file is left behind; whether other outputs still get rendered.
- Whether crowbook runs the tex command twice, and any warning text about it.
- Also: what does 'output.pdf' + missing xelatex do to the exit code (0 or nonzero?).`,
  },
  {
    key: 'i18n',
    file: '/tmp/explore/09-i18n.md',
    prompt: `Facet: LOCALIZATION / i18n strings.
Crowbook localizes both (a) its own UI messages (errors/warnings/info), controlled by -L/--lang
or the LANG env var, and (b) strings inside generated books, controlled by the book's 'lang' option.
Determine:
- The complete list of languages supported for (a) and for (b). Probe a wide range of codes:
  en, fr, es, de, it, pt, pt_BR, nl, ru, uk, pl, cs, sv, no, da, fi, ja, zh, ko, ar, he, tr, el,
  hu, ro, ca, eo, id, vi, th, hi, sr, hr, sk, sl, bg, lt, lv, et, is, ga, cy, eu, gl, af, sw, fa.
  For each, record whether messages/book strings are translated or fall back to English.
- For every localized book string, dump its value in EVERY supported language. Known strings:
  the TOC name ('Table des matieres' in fr), 'Titre'/'Title', 'Cover', 'Chapter'/'Chapitre',
  'Part'/'Partie', 'Notes', 'Display all chapters'/'Display one chapter', prev/next chapter
  labels in html.dir output. Find them by rendering a book with cover, parts, footnotes,
  inline_toc, html.dir, one_chapter, in each language.
- For UI messages: with -L <lang>, record translated forms of at least: the 'CROWBOOK 0.17.0'
  banner, 'is not a valid template name', errors for missing files, warnings, and the --help text.
  Does --help itself get translated?
- How language codes are normalized (fr_FR vs fr-FR vs FR vs fr_CA), and the fallback chain.
- The value of html lang="..." and epub dc:language for each input form.
Be exhaustive: this becomes a translation table in the reimplementation. Write the table as
a markdown table (or a JSON blob) in your notes file so it can be transcribed directly.`,
  },
  {
    key: 'highlight',
    file: '/tmp/explore/10-highlight.md',
    prompt: `Facet: SYNTAX HIGHLIGHTING (syntect-based) in HTML, EPUB and LaTeX.
rendering.highlight = syntect (default) | highlight.js | none; rendering.highlight.theme
(default InspiredGitHub); per-format overrides html.highlight.theme, epub.highlight.theme,
tex.highlight.theme.
Determine:
- The exact HTML produced for a fenced code block with a language tag under syntect: the wrapper
  element(s), inline style attributes, per-token span colors. Provide the exact bytes for several
  languages (rust, c, python, javascript, html, json, yaml, toml, bash/sh, markdown, ruby, java,
  go, php, sql, xml, css, diff, makefile, latex, lisp, haskell, perl, r, scala, swift, objective-c,
  erlang, lua, ocaml, clojure, d, graphviz, matlab, pascal, plain text, and an unknown tag like 'foo').
  Record which language names/aliases are recognized (probe aliases: rs, py, js, ts, sh, yml, ...).
- The exact list of available themes: probe rendering.highlight.theme with plausible syntect
  default theme names (InspiredGitHub, Solarized (dark), Solarized (light), base16-ocean.dark,
  base16-ocean.light, base16-eighties.dark, base16-mocha.dark) and record the error message for an
  invalid theme name; the error may enumerate valid names.
- For the SAME small code sample, dump the highlighted output for EVERY valid theme so we can
  extract the color tables. Save each dump to /tmp/explore/highlight/<theme>-<lang>.html.
- The LaTeX output for highlighted code blocks (colors via \\textcolor? definecolor?) byte-exact.
- rendering.highlight = highlight.js: what markup + which files are emitted.
- rendering.highlight = none: exact markup.
- Whether the theme background/foreground is applied to the wrapper.
This is a large data-extraction job; prioritize (1) exact markup shape, (2) InspiredGitHub colors
for common languages, (3) enumerating themes and languages.`,
  },
  {
    key: 'templating',
    file: '/tmp/explore/11-templating.md',
    prompt: `Facet: THE TEMPLATE ENGINE.
Crowbook templates use two syntaxes: '{{var}}' / '{% if x %}...{% endif %}' for HTML/EPUB
templates, and '<<var>>' / '<# if x #>...<# endif #>' for LaTeX templates.
By supplying custom template files (html.standalone.template, html.dir.template,
epub.chapter.xhtml, epub.titlepage.xhtml, tex.template, html.css, epub.css, html.css.colors,
html.js, html.css.print, html.chapter.template, html.part.template, rendering.chapter.template,
rendering.part.template, rendering.inline_toc.name, tex.pageref_template) determine:
- The FULL set of variables available in each template (dump them by referencing candidate names
  and seeing what renders; also see what an undefined variable does: error? empty?).
- Control flow supported: {% if %}, {% else %}, {% elif %}, {% endif %}, {% for %}, {% raw %}?
  Negation ('<# if not stdpage #>' appears in tex.template — so 'not' exists). '{% if a and b %}'?
  Comparisons ('==', '!=')? Filters ('|upper')? Test and record what works and the error text
  for what does not.
- Whitespace handling: are '{%- -%}' trims supported? Is the newline after a tag consumed?
  This matters for byte-exact output: study the default templates vs actual output to infer.
- HTML escaping: is '{{title}}' escaped? Is there a '{{title_raw}}' distinction (yes) - what
  exactly differs? Test titles containing <>&"' and markdown.
- Error messages for malformed templates, unknown template file paths, unreadable files.
- Whether templates are looked up relative to resources.base_path.templates.
- For tex.pageref_template only '<<key>>' is allowed - test other vars.
Provide precise semantics for reimplementation, including how the default templates' if-blocks
produce the observed whitespace in real output.`,
  },
  {
    key: 'stats-misc',
    file: '/tmp/explore/12-stats-misc.md',
    prompt: `Facet: --stats, --autograph, fancy UI, logging levels, and misc runtime behavior.
Determine:
- -S/--stats: exact output format for books with 0/1/many chapters, with words/chars counts.
  Work out precisely what is counted (words? chars? how are markdown syntax, footnotes, code
  blocks counted?). Try to reproduce the numbers with a python word-count on several inputs
  until you can state the exact counting rule. Record whether it also renders outputs.
- -a/--autograph: it prompts on stdin. Feed it stdin (echo/printf, and EOF, and multi-line
  input terminated how?) and record the prompt text, where it appears, and where the autograph
  ends up in HTML/EPUB/TeX output (is it markdown-rendered?).
- Logging: the 'CROWBOOK 0.17.0' banner, INFO/WARNING/ERROR/DEBUG prefixes, colors/ANSI codes
  (test with output piped vs a pty if possible), -v/--verbose extra messages, -q/--quiet,
  -n/--no-fancy. Which stream each goes to. Exact text of the 'Successfully generated ...' style
  messages for each output format (this is important - capture them all verbatim).
- The end-of-run summary: 'Crowbook exited successfully, but the following errors occurred:'
  and how multiple errors are aggregated and ordered; the exit code in that case.
- Exit codes for: success, all-outputs-failed, config parse error, missing input file, bad flag.
- What happens with no output.* option set at all (does it warn 'no output format specified'?).
- Rendering to a path in a nonexistent directory; permission errors.
- Behavior when the same output file is specified twice; when output path is a directory.
- Whether it prints anything to stdout at all in normal operation (vs stderr).
- Any progress/spinner output when fancy UI is on (piped output probably disables it).`,
  },
]

phase('Probe')
const summaries = await parallel(FACETS.map(f => () =>
  agent(`${RULES}\n\nWrite your spec to: ${f.file}\n\n${f.prompt}`,
    { label: `probe:${f.key}`, phase: 'Probe' })
))

phase('Critic')
const critics = await parallel(FACETS.map((f, i) => () =>
  agent(`${RULES}

A previous engineer probed the reference binary for one facet and wrote ${f.file}.
Read that file. Your job is to be a COMPLETENESS CRITIC and GAP FILLER for it:
1. Identify what is missing, vague, unverified, or stated without a byte-exact example.
2. Actually run /tmp/ref/crowbook to fill those gaps yourself.
3. APPEND a section '## Gap-fill round 2' to ${f.file} with your additional exact findings,
   and correct any statements in the file that you find to be WRONG (edit them in place,
   marking corrections clearly).
Focus especially on anything needed for byte-exact output reproduction.

The original facet brief was:
${f.prompt}`, { label: `critic:${f.key}`, phase: 'Critic' })
))

return { probes: summaries.map((s, i) => ({ facet: FACETS[i].key, summary: s })).filter(x => x.summary),
         critics: critics.map((s, i) => ({ facet: FACETS[i].key, summary: s })).filter(x => x.summary) }
