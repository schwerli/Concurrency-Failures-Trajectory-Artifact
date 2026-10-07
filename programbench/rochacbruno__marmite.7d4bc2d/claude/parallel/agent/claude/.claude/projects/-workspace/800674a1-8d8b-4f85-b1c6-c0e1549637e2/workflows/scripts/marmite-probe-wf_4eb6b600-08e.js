export const meta = {
  name: 'marmite-probe',
  description: 'Black-box probe of the marmite static site generator across 16 behavioral areas',
  phases: [{ title: 'Probe', detail: '16 parallel black-box probes writing spec files' }],
}

const PREAMBLE = `You are reverse-engineering the OBSERVABLE BEHAVIOR of a static site generator binary, by BLACK-BOX OBSERVATION ONLY.

The reference binary is at /tmp/orig/marmite_ref  (it self-identifies as \`marmite 0.2.7\`). Run it like: \`/tmp/orig/marmite_ref --help\`, \`/tmp/orig/marmite_ref <input_dir> <output_dir>\`.

HARD RULES (violating these fails the whole benchmark):
- NEVER decompile/disassemble/inspect the binary: no objdump, nm, readelf, strings, gdb, ghidra, radare2, strace, ltrace, ldd-based analysis. Do not run \`strings\` on it. Do not grep the binary file.
- NEVER look for marmite's source code anywhere (no internet - there is none - no package registries, no pip/cargo/npm).
- ONLY run the binary with CLI flags + input files, and read the files/stdout/stderr it produces.

You have a scratch dir. Create and work in /tmp/probe/AREA_NAME/ (use your area name). Never write outside /tmp/probe/.

DELIVERABLE: write an EXHAUSTIVE, PRECISE implementation spec to /tmp/probe/findings/AREA_NAME.md
It must be detailed enough that another engineer can reimplement that area byte-exactly WITHOUT re-running the binary. Include: exact literal strings, exact output snippets (fenced), exact file names, exact ordering/sorting rules, exact escaping, edge cases, and what happens on malformed input. Prefer concrete observed evidence over speculation; mark any guesses clearly as GUESS.
Save important raw artifacts under /tmp/probe/artifacts/AREA_NAME/.
Be systematic and generous with experiments - run dozens of variations. Time is not a constraint.

Your final reply to me: a SHORT summary (max 40 lines) of the highest-value discoveries plus the findings file path. Do not paste the whole spec.
`;

const AREAS = [
  { key: 'cli', prompt: `AREA: cli
Probe the command line interface exhaustively.
- Capture the EXACT full text of \`--help\`, \`-h\`, \`--version\`, \`-V\` (save verbatim to artifacts).
- Behavior with no args, with a nonexistent input folder, with a file instead of folder, with too many args, with unknown flags, with invalid values for typed flags (e.g. --https maybe, --pagination abc). Record exact stderr text and EXIT CODES.
- Default output folder when OUTPUT_FOLDER omitted (relative to input).
- Log output format at -v, -vv, -vvv, -vvvv and default (0). Exact prefix format e.g. "[2026-08-10T13:27:23Z INFO  marmite::site] ...". Which module names appear. What is logged at warn level by default (try to trigger warnings).
- \`--generate-config\`: exact generated file content + name + behavior if file exists.
- \`--shortcodes\`: exact stdout.
- \`--show-urls\`: exact stdout for a small site (and note it also builds the site or not).
- \`--force\`, and the "no changes detected" incremental-build behavior: does a second run skip work? What determines change detection? What is printed?
- The final success message printed on a normal build (exact text, e.g. "Site generated at ...").
- Anything printed to stdout vs stderr (test with 1>/dev/null and 2>/dev/null).
- Combinations: flags that conflict, flags that short-circuit (do they still need INPUT_FOLDER?).` },

  { key: 'config', prompt: `AREA: config
Probe the configuration file handling.
- Start from \`--generate-config\` output and from the "config" object inside the generated site's marmite.json (build any small site; marmite.json contains the full resolved config).
- Determine every YAML key accepted in marmite.yaml, its type, its default, and its effect. Set each one and observe changes in generated output.
- CLI-flag vs config-file precedence for every overlapping option.
- \`--config FILE\` with a nonexistent file, an invalid YAML file, an unknown key, a wrong-typed value: exact messages + exit codes.
- Does it accept marmite.yml / marmite.yaml / marmite.json / marmite.toml? Test all.
- Nested structures: \`extra\` (arbitrary map), \`authors\` (map of username -> {name, bio, avatar, links}), \`streams\` (map of name -> {display_name, ...}), \`series\` (map), \`menu\` (list of [name, url] pairs), \`file_mapping\` (list of {source, dest}?), \`toc\`, \`json_feed\`, \`https\`, \`url\` handling (trailing slash, protocol-less url + https flag), \`site_path\`, \`content_path\`, \`static_path\`, \`templates_path\`, \`media_path\`, \`gallery_*\`, \`markdown_parser\`, \`theme\`, \`image_provider\`, \`source_repository\`, \`publish_md\`, \`shortcode_pattern\`, \`enable_shortcodes\`, \`build_sitemap\`, \`publish_urls_json\`, \`skip_image_resize\`, \`default_author\`, all the \`*_title\` and \`*_content_title\` strings (and their $tag/$year/$stream/$series placeholders).
- How does url_for behave with url set vs unset, site_path set, abs=true.
- Report the exact marmite.json shape (all keys, order, formatting/indentation).` },

  { key: 'frontmatter', prompt: `AREA: frontmatter
Probe how a markdown file's metadata is derived.
- YAML frontmatter delimiters: \`---\`, \`+++\`? \`;;;\`? leading blank lines? BOM? CRLF? Test which are accepted.
- Every recognized frontmatter key and its effect: title, date, updated/modified?, tags/tag, authors/author, slug, description, stream, series, pinned, toc, banner_image, card_image, extra, comments, published, draft?, template?, menu?, ... Discover by experiment; check which end up in marmite.json/urls.json/HTML/feeds.
- Value forms: tags as YAML list vs comma-separated string vs single string; authors likewise; date as many formats (2024-01-01, 2024-01-01 10:20, 2024-01-01T10:20:30, 2024-01-01 10:20:30, with Z/offset, only year?, invalid) - record which parse and what the resulting rendered date is (default format "%b %e, %Y") and the ISO used in feeds/datetime attrs; record error/warn messages for unparseable dates.
- Title derivation precedence: frontmatter title > first H1 in body > filename-derived. Exact filename-to-title transformation (dashes/underscores/case). Is the H1 removed from the body when used as title?
- Slug derivation: frontmatter slug > filename. Date prefix stripping from filename (e.g. 2024-01-01-my-post.md). Stream prefix in filename (e.g. \`stream-name.post.md\` or similar dotted forms) - experiment with dots and various patterns.
- Post vs page classification (has date = post, no date = page). How does file mtime/git date factor in? Does a file with no date get the file's mtime? Test.
- draft stream behavior (stream: draft), published: false, future dates.
- Save example inputs+outputs as artifacts.` },

  { key: 'markdown-core', prompt: `AREA: markdown-core
Probe the markdown -> HTML conversion for CORE CommonMark constructs. The rendered body appears in the generated \`<slug>.html\` inside \`<div class="content-html e-content">...</div>\`.
Method: create one markdown file per construct (or a big file), build, and extract the exact HTML. Write a small script to make this fast.
Cover: paragraphs & soft/hard line breaks (2 spaces, backslash), ATX + setext headings (and their id/anchor generation - check for \`<h2><a href="#..." ...\` or id attributes), thematic breaks, fenced code blocks (info string -> class name, tildes, indentation, unclosed), indented code blocks, blockquotes (nested, lazy), bullet + ordered lists (start attr, tight vs loose, nesting, markers), inline emphasis/strong edge cases, inline code (backtick runs, spaces), links (inline, reference, collapsed, shortcut, title quoting, angle brackets, url escaping/percent-encoding), images (title, alt with markup), autolinks (\`<http://x>\`), raw inline HTML and HTML blocks (is raw HTML passed through or escaped? test \`<script>\`), entity references (&amp; &copy; &#35;), backslash escapes, hard-to-render nesting, tabs, trailing whitespace, unicode.
Also: exact escaping of \`&\`, \`<\`, \`>\`, \`"\` in text and in attributes. Whether output uses \`<br />\` or \`<br>\`, self-closing style for \`<hr />\`, \`<img ... />\`.
Determine whether smart punctuation (quotes/dashes/ellipsis) is applied.
Report each construct with input and exact output.` },

  { key: 'markdown-ext', prompt: `AREA: markdown-ext
Probe markdown EXTENSIONS beyond core CommonMark. Same extraction method as needed (build a site, read the \`<div class="content-html e-content">\` of the generated page).
Test and report exact HTML for: GFM tables (alignment, escaping pipes, ragged rows), strikethrough (\`~~x~~\` and single \`~x~\`), task lists (\`- [ ]\`, \`- [x]\` - exact checkbox HTML), autolink extension (bare www.x.com, http://x, foo@bar.com), footnotes (\`[^1]\` definitions - exact HTML incl. ids, backrefs, section markup), description/definition lists, superscript (\`^x^\`), subscript, math (\`$x$\`, \`$$x$$\`, \`\`\`math), wikilinks (\`[[Page]]\`, \`[[Page|Label]]\`, \`[[folder/Page]]\`), spoiler (\`||text||\`), underline, GitHub alerts (\`> [!NOTE]\`), header attributes (\`# Title {#custom-id}\`), tagfilter (does \`<title>\`/\`<textarea>\` get escaped?), emoji shortcodes (\`:smile:\`), mentions.
For each: state clearly ENABLED or DISABLED with the evidence (exact output).
Also determine heading anchor/id slug algorithm precisely with tricky headings (punctuation, unicode, duplicate headings -> suffixes?, numbers, emoji, inline code, links inside heading).
Also check the \`markdown_parser\` config option's effect if any.` },

  { key: 'shortcodes', prompt: `AREA: shortcodes
Probe the shortcode system.
- \`/tmp/orig/marmite_ref --shortcodes\` lists them; capture exactly.
- For EACH listed shortcode, use it in a markdown file and capture the exact expanded HTML, with and without arguments. Determine argument syntax (positional? key=value? quoted?), defaults, and what happens with missing/unknown args.
- The default pattern is the regex \`<!-- \\.(\\w+)(?:\\s+([^-][\\s\\S]*?))?\\s*-->\` per --help. Verify: are shortcodes written as HTML comments like \`<!-- .youtube abc -->\`? Test multiline args, args spanning lines, adjacent shortcodes, shortcodes inside code blocks/fences, inside frontmatter, in special files (_hero.md etc), and in page vs post.
- Custom shortcodes: is there a folder (e.g. \`shortcodes/\` or \`templates/shortcodes/\`) where a user \`.html\` file defines a new shortcode? Test creating one (try several plausible locations, and check \`--init-templates\`/\`--start-theme\` output for hints). Determine the template language available inside a shortcode and how args are exposed.
- \`--enable-shortcodes false\` and a custom \`--shortcode-pattern\` behavior.
- Whether shortcode expansion happens before or after markdown parsing (test with markdown inside the expansion).` },

  { key: 'special-files', prompt: `AREA: special-files
Probe "special" content files - markdown files whose names start with underscore, and other magic files.
Discover which are recognized and what each does. Candidates to test (create each, build, diff the output HTML): _footer.md, _hero.md, _sidebar.md, _announce.md, _header.md, _comments.md, _htmlhead.md, _htmltail.md, _404.md, _references.md, _markdown_header.md, _markdown_footer.md, _index.md, _pages.md, _tags.md, _archive.md, _streams.md, _series.md, _authors.md, _empty.md, and any \`_<anything>.md\`.
For each recognized one: where does its rendered content land in the output (which template variable / which page), is it markdown-rendered or raw, is it excluded from post/page listings, does frontmatter in it matter?
Also test: index.md (does it become the site index / hero?), 404.md, about.md.
Also test how unrecognized \`_foo.md\` files are treated (warning? ignored? published?).
Also: link-reference definitions shared across files via _references.md, and whether _markdown_header/_markdown_footer content is prepended/appended to every content file.
Also probe how a custom \`custom_index.html\` template (see templates/custom_index.html.example after --init-templates) changes the index page, and \`content_<slug>.html\`/\`list_<something>.html\` per-page template overrides if they exist.` },

  { key: 'site-structure', prompt: `AREA: site-structure
Probe the full set of generated output files and the rules that produce them, using a RICH fixture site: ~25 posts across multiple tags, several authors, 2 streams, 2 series, multiple years, some pages (no date), pinned posts, drafts, unicode titles, plus pagination (set pagination: 3).
Report:
- Exact list of output files and the naming scheme for every page type: index.html, index-N.html, tag-<slug>.html + tag-<slug>-N.html, tags.html, archive.html, archive-<year>.html + -N, author-<slug>.html + -N, authors.html, <stream>.html + -N, streams.html, series-<slug>.html + -N, series.html, pages.html, 404.html, <slug>.html, sitemap.xml, urls.json, marmite.json, robots.txt, static/*, media/*.
- Pagination rules: how many items per page, is index.html page 1 and index-1.html a duplicate? What are index-1/index-2 exactly? previous_page/next_page/current_page_number/total_pages values.
- Sort order of: index list, tag lists, archive lists, stream lists, series lists (ascending?), pages list, tags.html tag ordering (by count? name?), authors.html, streams.html, series.html ordering. PINNED posts placement. Ties (same date) tiebreak.
- Which content is excluded where: drafts (stream: draft), pages vs posts, published:false, future-dated.
- Exact urls.json structure incl. which URLs land in which bucket and the sorting within buckets, and the summary/meta block.
- Exact marmite.json structure (fields, formatting) and which fields vary run-to-run.
- sitemap.xml exact content and URL ordering.
- 404.html content and how to override it.
- media/ folder copying rules; publish_md behavior (which .md files are copied where); file_mapping behavior.
- Save the whole fixture input + output tree under artifacts.` },

  { key: 'feeds', prompt: `AREA: feeds
Probe RSS and JSON feeds.
- Build a rich site (several posts with tags, authors, streams, series, archives, descriptions, unicode, HTML in content) and capture index.rss verbatim.
- Report the EXACT XML: declaration, root element + attributes/namespaces, channel children and their order, item children and their order, date formats (RFC822? exact strftime), guid, link, description (CDATA? escaped HTML? truncated?), author, category elements, generator, lastBuildDate, ttl, atom:link, exactly how special chars are escaped, pretty-printing/indentation and newlines, trailing newline.
- Which feeds are generated (index.rss, tag-*.rss, author-*.rss, series-*.rss, archive-*.rss, <stream>.rss) and their titles/descriptions/links.
- Item count limits (does it cap at N items? test with 40 posts).
- Ordering of items. Are pages included? drafts?
- \`--json-feed true\`: exact JSON Feed output (version url, keys, ordering, indentation) for index.json and the per-group .json files.
- How \`url\` config affects links in feeds (empty url vs https://example.com vs example.com + https flag).
Save verbatim artifacts.` },

  { key: 'template-engine', prompt: `AREA: template-engine
Probe the TEMPLATE ENGINE and its filters/functions/tests. The engine is Jinja2-like (Tera-flavoured). You can write ARBITRARY custom templates: run \`/tmp/orig/marmite_ref <in> <out> --init-templates\` to dump the default templates into <in>/templates/, then EDIT them (e.g. replace list.html's block main with probe expressions) and rebuild to observe rendered output. This is your main instrument - build a fast probe loop where you inject an expression into a template and read the rendered result.
Determine precisely:
- Syntax supported: {{ }}, {% %}, {# #}, whitespace control ({%- -%}, {{- -}}), extends/block/super(), include with/without "ignore missing", set, for (+ loop.index, loop.index0, loop.first, loop.last, loop.length), for-else, if/elif/else, break/continue, filter blocks?, raw blocks?, macros?
- Operators: + - * / %, ~ (concat), comparisons, and/or/not, in, parentheses, string/number/bool/array/map literals, indexing a.b, a["b"], a.0, a[0], negative index?
- Tests: is defined / is not defined, is string, is number, is odd/even, is starting_with(x), is ending_with, is containing, is matching, is iterable, is object, is empty.
- BUILTIN FILTERS: for each of these, determine exact semantics with tricky inputs and DOCUMENT the algorithm: safe, escape, length, truncate(length,end), striptags, trim, trim_start, trim_end, trim_start_matches(pat), trim_end_matches(pat), replace(from,to), slugify, lower, upper, title, capitalize, first, last, nth, join(sep), split(pat), sort(attribute), reverse, slice(start,end), filter(attribute,value), map(attribute), group_by, unique, concat, default(value), round(method,precision), int, float, abs, date(format,timezone), urlencode, json_encode(pretty), get(key), keys, values, wordcount, indent, linebreaksbr, markdown?, as_str.
  - ESPECIALLY: slugify (test unicode, accents, punctuation, spaces, case, leading/trailing dashes, repeated separators, emoji, CJK), truncate (does it count chars or graphemes, where does it cut, does it strip trailing partial word, exact suffix behavior when shorter than length), striptags (what exactly is removed, whitespace handling, entities), date(format=...) supported strftime specifiers incl %+ %b %e %Y %H %M %S %z, and custom filter default_date_format, remove_draft.
- CUSTOM FUNCTIONS: url_for(path, abs), group(kind) [kinds: tag, archive, author, stream, series - what does it return, ordering, item shape], stream_display_name(stream), series_display_name(series), source_link(content), and any other function you can discover by trial (calling an undefined function produces an error message that reveals nothing - but you can test plausible names).
- ERROR behavior: what happens on a template syntax error, unknown filter, unknown variable in {{ }} (error or empty?), unknown attribute, out-of-range index. Capture exact error messages and exit codes.
- The COMPLETE context available to each template: dump it. Trick: use a filter like json_encode on the whole context or on known variables, or iterate. Try \`{{ __tera_context }}\` and \`{{ site | json_encode(pretty=true) }}\`, \`{{ content | json_encode(pretty=true) }}\`, \`{{ content_list | json_encode }}\`, \`{{ site_data | json_encode }}\`. THIS IS THE HIGHEST-VALUE EXPERIMENT: it reveals the exact data model (field names, types, null vs missing) for site, content, content_list, site_data, author, group items, etc. Do it for content.html, list.html, group.html and save the JSON dumps as artifacts.
- Which template file is used for which page (content.html, list.html, group.html, custom_index.html, sitemap.xml, and any per-slug override like content_<slug>.html / list_<stream>.html).` },

  { key: 'serve-watch', prompt: `AREA: serve-watch
Probe \`--serve\` and \`--watch\`.
- Start \`/tmp/orig/marmite_ref <in> <out> --serve --bind 127.0.0.1:PORT\` in the background (use a unique high port; always kill it after). Capture the exact log/stdout lines it prints on startup.
- With curl: GET /, /index.html, /hello-world.html, /static/marmite.css, /nonexistent, a directory path without trailing slash, a path with trailing slash, /..%2f traversal attempt, HEAD request, unsupported method (POST), HTTP/1.0 request. Record exact status lines, ALL response headers (curl -i), Content-Type per extension (.html .css .js .json .xml .rss .png .ico .woff .md .txt .svg), Content-Length, whether keep-alive is used, and the body for 404 (does it serve 404.html?).
- Does it log each request? Exact format.
- Is any live-reload script injected into served HTML? Diff served HTML vs on-disk HTML.
- \`--serve\` without \`--watch\`: does it rebuild on change? \`--watch\` alone: does it rebuild on change, what does it log, how fast, what triggers (content files, templates, static, config)? Does it debounce?
- Behavior when the port is in use; when bind address is invalid.
- Whether --serve implies --watch or vice versa.
- Does the server exit on SIGINT cleanly with a message?
Be careful to always clean up background processes.` },

  { key: 'scaffolding', prompt: `AREA: scaffolding
Probe the scaffolding/authoring commands. For each, capture the EXACT files created and their EXACT contents (save to artifacts), plus log/stdout text and exit code, and behavior when files already exist.
- \`--init-site\` (on an empty dir and on a dir with existing files)
- \`--generate-config\`
- \`--init-templates\`
- \`--start-theme NAME\` (what does it create? templates + static? where?)
- \`--set-theme <local folder>\` (create a plausible local theme folder and set it; what gets copied/changed? what does it do to marmite.yaml? what about a remote URL - no network, so capture the error text)
- \`--new "My Title"\` with and without -p, -t "a,b", -e, and with EDITOR/VISUAL unset vs set to \`true\`/\`/bin/echo\`. What filename is produced, in which folder, with what frontmatter (exact bytes incl. date value format)? Does it print anything? What if the file exists?
- \`--theme NAME\` config/flag: how does a theme folder affect template/static resolution (precedence: input/templates > theme/templates > embedded)?
- Interaction: do these commands still build the site afterwards?` },

  { key: 'media-gallery', prompt: `AREA: media-gallery
Probe media, images and galleries.
- Where must media files live (content/media? media/?) and where are they copied to in the output? Test with a media/ folder containing .png/.jpg/.svg/.pdf/.mp4 and subfolders.
- Image resizing: create real images (use python3 with no external libs - write minimal valid PNG/JPEG via zlib/struct, or copy the site's own static/logo.png and avatar-placeholder.png as test inputs) of various sizes and see whether marmite rewrites/resizes them, creates extra files (e.g. thumbnails, -thumb suffix, .webp), and what \`--skip-image-resize true\` changes. Report exact output file names and whether bytes change (compare sha256 to input).
- Galleries: the log mentions "Processing galleries from: ./media/gallery" and config has gallery_path, gallery_create_thumbnails, gallery_thumb_size. Create content/media/gallery/<name>/ with images and observe: what output files/pages are produced, what HTML, what thumbnails (size semantics of gallery_thumb_size), is there a gallery shortcode or a generated gallery page? Test gallery_create_thumbnails false.
- banner_image / card_image: auto-detection from content (first image in the post?), from frontmatter, from a file named after the slug (e.g. media/<slug>.banner.jpg?), and how they end up in HTML/meta tags.
- \`--image-provider picsum\`: with no network, capture exact error/warn text and whether the build still succeeds.
- Report precisely which image work my reimplementation must do; if the tool never re-encodes images unless galleries/banners are used, say so explicitly with evidence.` },

  { key: 'toc-related', prompt: `AREA: toc-related
Probe table of contents, backlinks, related content, and next/prev navigation.
- \`toc: true\` in config and in a post's frontmatter. Capture the EXACT generated TOC HTML for a post with h1..h6 in various nesting orders (including skipped levels, duplicate headings, headings with inline markup/links/code, unicode headings). Determine the list markup, indentation, anchors, and how it relates to heading ids.
- Heading anchor generation: exact id/slug algorithm and whether an anchor link element is inserted into the heading.
- Backlinks: create posts that link to each other with \`[[wikilink]]\` and with normal markdown links to \`other.html\`/\`other.md\`. Determine what populates \`content.back_links\` (exact HTML section "Back-links" appears in output). Which link forms count? Are drafts/pages counted? Ordering? Limit?
- Related content: the "Related <tag> content" section - exact rules (first tag only, sorted by date desc, max 5, excludes self and back_links). Verify.
- next/prev links: ordering semantics (previous = older or newer?), scope (within stream? within series? global?), for pages, for drafts, exact HTML.
- Series navigation: does a post in a series get series-specific prev/next or a series index list?
- \`enable_related_content false\` and \`show_next_prev_links false\` effects.` },

  { key: 'assets', prompt: `AREA: assets
Extract every embedded static asset BYTE-EXACTLY and catalogue them.
- Build a site; copy the whole \`static/\` tree (and any other embedded output like robots.txt, favicon.ico) into /tmp/probe/artifacts/assets/static/ preserving paths. Record \`sha256sum\` and byte size of every file in a manifest file.
- Determine which of these are written unconditionally vs conditionally (e.g. search.js only when enable_search, colorschemes always?, logo.png, avatar-placeholder.png, the .woff font, custom.css/custom.js as EMPTY files).
- Note the exact copy/overwrite rules: does a user-provided \`static/\` folder in the input override embedded files (per-file merge or whole-folder replace)? Does a user \`custom.css\` get copied? Where does robots.txt end up (both out/static/robots.txt and out/robots.txt?). What if user provides their own robots.txt/favicon.ico?
- Does \`--start-theme\` or \`--set-theme\` emit MORE embedded assets than a normal build? If so extract those too.
- Check whether static file writing is skipped when the output file already exists with same content (incremental).
- Also record the exact contents of the small text assets (robots.txt, custom.css, custom.js) inline in your findings.
- Do NOT run \`strings\`/objdump on the binary; extract only via generated output.` },

  { key: 'search-json', prompt: `AREA: search-json
Probe the search feature and any JSON data files.
- \`--enable-search true\`: what extra files appear in the output? Capture the search index file name and its EXACT format (JSON? array of objects? which fields: title, slug, html/content, description, tags, date? Is HTML stripped? Is content truncated? escaping? indentation? ordering? are pages/drafts included?).
- Read the generated \`static/search.js\` (it is an emitted asset, fair game) to understand what file/format it expects, and confirm by inspecting the generated index.
- Report exact bytes of a small search index, and the rules for which content is indexed.
- Also fully document \`urls.json\` (--publish-urls-json) and \`marmite.json\`: every key, value type, ordering, JSON indentation style, and which values are nondeterministic (timestamps, elapsed_time).
- Also check for any other machine-readable outputs (e.g. .json per stream when json_feed enabled - just note existence; another agent covers feeds).` },
];

phase('Probe')

const SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    findingsPath: { type: 'string' },
    summary: { type: 'string', description: 'Max 40 lines of highest-value discoveries' },
    surprises: { type: 'array', items: { type: 'string' }, description: 'Behaviors an implementer would likely get wrong' },
  },
  required: ['area', 'findingsPath', 'summary'],
}

const results = await parallel(AREAS.map(a => () =>
  agent(`${PREAMBLE}\n\n${a.prompt}\n\nRemember: AREA_NAME = "${a.key}". Write /tmp/probe/findings/${a.key}.md`, {
    label: `probe:${a.key}`,
    phase: 'Probe',
    schema: SCHEMA,
  })
))

return results.filter(Boolean)
