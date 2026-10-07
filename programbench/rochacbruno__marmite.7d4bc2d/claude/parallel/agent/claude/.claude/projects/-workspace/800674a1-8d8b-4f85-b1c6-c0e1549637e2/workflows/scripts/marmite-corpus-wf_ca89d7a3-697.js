export const meta = {
  name: 'marmite-corpus',
  description: 'Build golden differential-test corpora (markdown, template expressions, emoji table) from the reference binary',
  phases: [{ title: 'Corpus', detail: 'markdown corpus, template corpus, emoji table' }],
}

const PREAMBLE = `You are building GOLDEN TEST CORPORA by observing a reference binary's behavior. The binary is /tmp/orig/marmite_ref (a static site generator, "marmite 0.2.7").

HARD RULES (violating fails the benchmark):
- NEVER decompile/disassemble/inspect the binary: no objdump, nm, readelf, strings, gdb, strace, ltrace. Never run \`strings\` or grep on the binary file itself.
- NEVER look for the project's source code (no internet available anyway).
- ONLY run the binary on inputs and read its outputs.

USEFUL TECHNIQUE - isolate rendered markdown: create an input dir containing your .md files plus a \`templates/content.html\` file whose entire content is exactly \`{{ content.html }}\` (and empty \`templates/list.html\` + \`templates/group.html\` to suppress noise). Then \`/tmp/orig/marmite_ref <indir> <outdir>\` writes \`<outdir>/<slug>.html\` containing ONLY the rendered markdown body. A helper already exists at /workspace/tools/mdrender.py (read it).

CRITICAL GOTCHA you must account for: when a markdown file has no \`title:\` front matter key, marmite CONSUMES THE FIRST NON-BLANK LINE of the file as the title and removes it from the body. So every corpus file MUST start with front matter (\`---\\ntitle: t\\n---\\n\`) or a throwaway first line, or your golden output will be wrong. Verify this yourself first.
Also note: front matter \`title:\` changes the output slug (slug is derived from the title), so prefer adding an explicit \`slug:\` too, or verify how you map input file -> output file.

Work only under /tmp/probe/.`;

phase('Corpus')

const SCHEMA = {
  type: 'object',
  properties: {
    deliverable: { type: 'string' },
    counts: { type: 'string' },
    summary: { type: 'string' },
    surprises: { type: 'array', items: { type: 'string' } },
  },
  required: ['deliverable', 'summary'],
}

const tasks = [
  { key: 'md-corpus', prompt: `${PREAMBLE}

TASK: build an exhaustive golden corpus of markdown -> HTML pairs.

Deliverables:
1. /tmp/probe/mdcorpus/cases/<NNN>-<name>.md  - the markdown body ONLY (no front matter; the runner adds it)
2. /tmp/probe/mdcorpus/golden/<NNN>-<name>.html - the exact reference HTML for that body
3. /tmp/probe/mdcorpus/run.sh - usage: \`run.sh <path-to-binary> [outdir]\` -> renders every case with that binary into outdir and prints a per-case PASS/FAIL diff summary and a final "N/M passed" line. Must be fast (one build for all cases, not one per case).
4. /tmp/probe/mdcorpus/README.md - how it works + notable behaviors discovered.

Coverage requirements - at least 300 cases, one construct per case, small and focused:
- CommonMark core: tabs, backslash escapes, entity refs, code spans, emphasis/strong (the full tricky rule set: intraword, punctuation flanking, nesting, \`***\`, \`___\`), links (inline/reference/collapsed/shortcut/angle/parens/titles/escapes/percent-encoding of URLs), images, autolinks \`<...>\`, raw HTML inline and blocks (all 7 HTML block types), hard/soft breaks, ATX and setext headings, indented and fenced code (info strings, tildes, unclosed, blank lines inside), block quotes (nested, lazy continuation), lists (bullet/ordered, start numbers, tight vs loose, nested, mixed markers, empty items, interrupting paragraphs), thematic breaks, link reference definitions, paragraphs, blank line handling, unicode/CJK/emoji text, HTML entity edge cases, \`<\` \`>\` \`&\` \`"\` escaping in text and URLs.
- Extensions (verify each on/off status and encode the exact HTML): GFM tables (alignment rows, escaped pipes, inline code with pipes, ragged rows, empty cells), strikethrough (\`~~\`, single \`~\`, \`~~~\`), task lists (checked/unchecked/uppercase X/nested), autolink extension (bare urls, www., email, trailing punctuation, inside parens), footnotes (multiple, multi-paragraph, nested refs, unused defs, duplicate refs -> backref idx), description lists, GitHub alerts (NOTE/TIP/IMPORTANT/WARNING/CAUTION, lowercase, nested content), spoiler \`||x||\`, wikilinks \`[[a]]\` \`[[a|b]]\` \`[[dir/a]]\` (record the exact href transformation and data-wikilink attribute), emoji shortcodes \`:name:\`, and confirm which of superscript/subscript/math/underline/greentext/multiline-blockquote/tagfilter/smart-punctuation are DISABLED (include cases proving it).
- Heading id/anchor generation: many tricky headings (duplicates -> what suffix?, punctuation, unicode, accents, emoji, inline code, links, numbers, leading/trailing spaces, empty heading, very long).
- Also probe: does marmite post-process the HTML? (e.g. rewriting relative links \`other.md\` -> \`other.html\`, adding classes, lazy-loading images, wrapping tables). Include cases for links to \`.md\` files, absolute urls, anchors, images with relative paths, and media paths.
Report in README.md any case where the output looks like marmite (not the markdown library) is post-processing.` },

  { key: 'tpl-corpus', prompt: `${PREAMBLE}

TASK: build a golden corpus for the TEMPLATE ENGINE (a Jinja2/Tera-like language).

Technique: \`/tmp/orig/marmite_ref <in> <out> --init-templates\` writes the default templates to <in>/templates/. Replace \`templates/content.html\` with your own probe template. Each build renders it to <out>/<slug>.html. To test many expressions in one build, put many lines in the template, each line being one probe expression, and split the output by line. Beware: a template error may abort the whole build - so ALSO build a mode that tests one expression per build to isolate error messages.

Deliverables:
1. /tmp/probe/tplcorpus/cases.tsv - one line per case: \`ID<TAB>TEMPLATE_SNIPPET<TAB>EXPECTED_OUTPUT\` (use \\n / \\t escapes in the fields so it stays one line per case). At least 250 cases.
2. /tmp/probe/tplcorpus/run.sh <binary> - renders all snippets with the given binary and diffs against expected, printing PASS/FAIL per case and a total.
3. /tmp/probe/tplcorpus/errors.md - exact error messages + exit codes for: template syntax error, unknown filter, unknown function, unknown variable used in {{}}, unknown attribute, index out of range, wrong filter arg type, missing required filter arg, include of a missing template without \`ignore missing\`, extends of a missing template.
4. /tmp/probe/tplcorpus/README.md - the language reference you inferred (syntax, precedence, whitespace control, truthiness rules, how missing values render).

Coverage:
- Literals and rendering of: strings, ints, floats (e.g. \`{{ 1/3 }}\`, \`{{ 2.0 }}\`, \`{{ 1.5 + 1 }}\`), bools, arrays, maps, null/undefined.
- Operators: + - * / %, unary minus, string concat \`~\`, comparisons (numeric, string), and/or/not, \`in\` (string in string, item in array, key in map), parentheses, precedence.
- Statements: if/elif/else, for over array and over map (\`for k, v in map\`), loop.index/index0/first/last/length, for-else (empty), break, continue, set (inside and outside loops), set_global if it exists, filter blocks, raw blocks, macros (do they exist?), include, extends+block+super(), nested blocks, comments, whitespace control combinations ({{-, -}}, {%-, -%}) - include cases pinning EXACT whitespace/newlines, since this is the highest-risk area.
- Tests: defined, undefined, string, number, odd, even, divisibleby, iterable, object, empty, starting_with, ending_with, containing, matching (+ \`is not X\` forms).
- Filters (exact semantics with edge cases - empty string, unicode, multibyte, HTML, negative numbers, missing args): safe, escape, escape_xml, length, truncate(length,end), striptags, trim, trim_start, trim_end, trim_start_matches, trim_end_matches, replace, slugify, lower, upper, title, capitalize, first, last, nth, join, split, sort(attribute), reverse, slice(start,end), filter, map, group_by, unique, concat, default, round(method,precision), int, float, abs, urlencode, urlencode_strict, json_encode(pretty), get, keys, values, wordcount, indent, linebreaksbr, addslashes, spaceless, striptags, as_str, date(format,timezone), and the custom ones: default_date_format, remove_draft.
  For slugify and truncate and striptags and date, be EXHAUSTIVE - dozens of cases each; these are used in the site's own templates.
- Custom functions: url_for(path, abs), group(kind=tag|archive|author|stream|series), stream_display_name, series_display_name, source_link, get_env?, now?, range?, throw?
- ALSO: dump the full template context for a content page and for a list page using \`{{ __tera_context }}\` and/or \`{{ site | json_encode(pretty=true) }}\`, \`{{ content | json_encode(pretty=true) }}\`, \`{{ site_data | json_encode(pretty=true) }}\`, \`{{ content_list | json_encode(pretty=true) }}\`, \`{{ author | json_encode(pretty=true) }}\`, group items, pagination vars. Save these dumps to /tmp/probe/tplcorpus/context/*.json - they define the data model and are extremely valuable. Do it for a site that has: 3 posts (one with every front matter key set), 1 page, 2 tags, 2 authors, 1 series, 1 stream, drafts, pinned, toc enabled, search enabled, json_feed enabled, a config with extra/authors/streams/series/menu set.` },

  { key: 'emoji-table', prompt: `${PREAMBLE}

TASK: the markdown renderer converts \`:name:\` emoji shortcodes to emoji (e.g. \`:smile:\` -> 😄). Recover the shortcode -> emoji table as completely as you can, BY QUERYING THE BINARY.

Method:
1. Generate a large candidate list of shortcode names:
   - From python3's \`unicodedata\`: iterate all codepoints in emoji ranges (0x2000-0x3300, 0x1F000-0x1FAFF, plus misc), get \`unicodedata.name()\`, lowercase it, replace non-alphanumerics with \`_\`, collapse repeats, strip - that yields names like \`grinning_face\`. Also generate variants: without the trailing \`_face\`? no - instead also generate the name with words reordered? Keep it simple: exact transformed name, plus the name with \`_and_\` -> \`_\`, plus with \`with\`/\`of\` words dropped.
   - Plus a hand-written list of the classic GitHub/Slack aliases you know: smile, smiley, laughing, grin, blush, wink, heart, heart_eyes, thumbsup, thumbsdown, +1, -1, 100, tada, rocket, fire, eyes, warning, white_check_mark, x, sparkles, bug, memo, book, books, wrench, hammer, zap, star, star2, cat, dog, pizza, beer, coffee, sunny, cloud, umbrella, snowflake, ok_hand, wave, clap, pray, muscle, point_right, arrow_right, bulb, lock, key, mag, calendar, clock1, email, phone, computer, iphone, camera, art, musical_note, soccer, trophy, gift, moneybag, chart_with_upwards_trend, construction, no_entry, question, exclamation, information_source, recycle, checkered_flag, flag_us, poop/hankey, ghost, alien, robot_face, skull, crown, gem, balloon, cake, apple, banana, and as many more as you can recall (aim for 400+ hand-written aliases).
2. Test candidates in BULK: put e.g. 500 shortcodes per markdown file, one per line (each line \`:name:\` alone in its own paragraph or separated so you can map output lines back to input names). Render with the content.html trick. A name that is NOT a valid shortcode stays as literal \`:name:\` in the output. Watch out for line-merging: put each on its own line separated by blank lines, or wrap as \`X:name:X\` markers - design something robust and verify on a small batch first.
3. Record every name that DID convert, with its exact emoji (as UTF-8 and as codepoints).

Deliverables:
- /tmp/probe/emoji/table.tsv  - \`name<TAB>emoji<TAB>codepoints\` sorted by name
- /tmp/probe/emoji/table.rs   - a Rust source snippet: \`pub const EMOJI: &[(&str, &str)] = &[("smile", "\\u{1F604}"), ...];\` sorted by name
- /tmp/probe/emoji/README.md  - how many names were found, method, coverage caveats, and the exact rules for what counts as a shortcode (allowed characters in the name: letters/digits/_/+/-? case sensitivity? does \`:+1:\` work? what about \`: smile :\` or \`:smile:x\` or inside code spans/links/headings? does an invalid name stay literal?).
Aim for at least 1000 confirmed names; report the number you found.` },
]

const results = await parallel(tasks.map(t => () => agent(t.prompt, { label: t.key, phase: 'Corpus', schema: SCHEMA })))
return results.filter(Boolean)
