export const meta = {
  name: 'marmite-markdown',
  description: 'Two independent CommonMark+extensions renderer implementations, scored against a differential corpus',
  phases: [{ title: 'Implement', detail: 'two competing markdown renderers' }],
}

const PREAMBLE = `You are implementing the markdown renderer for a from-scratch Rust reimplementation of the "marmite" static site generator (a reverse-engineering benchmark). The reference binary is /tmp/orig/marmite_ref.

HARD RULES (violating these fails the whole benchmark):
- NEVER decompile/disassemble/inspect the reference binary (no objdump/nm/readelf/strings/gdb/strace/ltrace, no grep of the binary file).
- NEVER look for the original project's or any markdown library's source code. There is NO network access. Work from the CommonMark specification as you know it plus DIFFERENTIAL OBSERVATION of the reference binary.
- Rust 2021, std-only. NO external crates. Do not touch Cargo.toml.

HOW TO OBSERVE THE REFERENCE RENDERER
A helper exists: /workspace/tools/mdrender.py (read it). It builds a throwaway site whose \`templates/content.html\` is exactly \`{{ content.html }}\`, so each generated \`<slug>.html\` is the rendered markdown body verbatim.
CRITICAL GOTCHAS:
1. If a markdown file has no \`title:\` front matter key, the generator CONSUMES THE FIRST NON-BLANK LINE as the title and strips it from the body. Always give your test files front matter (\`---\\ntitle: t\\nslug: caseNNN\\n---\\n\`) so the body is rendered whole. \`slug:\` controls the output file name.
2. Something is appended/handled around the body: verify precisely whether a trailing newline or extra blank lines are added, and account for it in your comparisons.
3. Shortcode expansion runs on the markdown before/around rendering: HTML comments of the form \`<!-- .name args -->\` are replaced. Avoid that syntax in test cases unless testing it.

A golden corpus may exist (built by another agent) at /tmp/probe/mdcorpus/ with \`cases/*.md\` (bodies only), \`golden/*.html\` and \`run.sh\`. USE IT if present (check at the start and again later - it may appear while you work). Also read /tmp/probe/findings/markdown-core.md and /tmp/probe/findings/markdown-ext.md if they exist.

WHAT TO BUILD
Files you own (create them; do not edit any other file in /workspace):
  {{FILES}}
They must satisfy this exact contract, already declared in /workspace/src/markdown/mod.rs:
\`\`\`rust
pub struct Heading { pub level: u8, pub id: String, pub html: String }
pub struct Output { pub html: String, pub headings: Vec<Heading> }
pub fn render(markdown: &str) -> Output;     // implemented as block::render
pub fn toc(headings: &[Heading]) -> String;  // implemented as block::toc
\`\`\`
So your module must expose \`pub fn render(&str) -> crate::markdown::Output\` and \`pub fn toc(&[Heading]) -> String\` from \`block\`, and may put inline parsing in \`inline\`.
Emoji shortcodes: call \`crate::emoji::lookup(name) -> Option<&'static str>\`; that module is being written by someone else, so define it in your scratch crate as a stub with a few entries for testing, but in /workspace assume it exists (do NOT create /workspace/src/emoji.rs).

REQUIRED COVERAGE (verify each against the reference):
- Full CommonMark block structure: ATX + setext headings, paragraphs, blank lines, indented code, fenced code (backtick/tilde, info strings -> \`<pre><code class="language-X">\`), HTML blocks (all 7 types), block quotes (nested, lazy continuation), bullet + ordered lists (markers, start numbers, tight vs loose, nesting, interrupting paragraphs, empty items), thematic breaks, link reference definitions, tabs-as-4-spaces rules.
- Full CommonMark inlines: backslash escapes, entity + numeric references, code spans (backtick runs, stripping rules), emphasis/strong with the complete left/right-flanking delimiter run algorithm (this is the hardest part - implement the real algorithm, including \`***\`, \`___\`, intraword rules, nesting and the "rule of 3"), links (inline/reference/collapsed/shortcut, titles in all three quote styles, balanced parens, angle-bracket destinations, percent-encoding + entity handling of URLs), images, autolinks \`<...>\`, raw inline HTML, hard breaks (two spaces, backslash) and soft breaks.
- Extensions, all ENABLED: GFM tables; strikethrough (both \`~~x~~\` and single \`~x~\` -> \`<del>\`); task lists (\`<input type="checkbox" disabled="" />\` / \`checked="" disabled=""\`); GFM autolinks (bare http(s)://, www., email -> mailto:); footnotes (\`<sup class="footnote-ref">\`, \`<section class="footnotes" data-footnotes>\`, backrefs with \`data-footnote-backref-idx\`); description lists (\`<dl><dt><dd>\`); header anchors (\`<h1><a href="#slug" aria-hidden="true" class="anchor" id="slug"></a>Text</h1>\`); wikilinks \`[[Target]]\` and \`[[Title|Target]]\` -> \`<a href="<slug>.html" data-wikilink="true">Title</a>\` (determine the exact href transformation empirically, including spaces, subfolders and case); spoiler \`||text||\` -> \`<span class="spoiler">\`; GitHub alerts \`> [!NOTE]\` -> \`<div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title">Note</p>...\`; \`:emoji:\` shortcodes.
- Extensions that are DISABLED (must pass through literally): superscript \`^x^\`, subscript, math \`$x$\`, underline, greentext, smart punctuation (quotes/dashes stay ASCII), tagfilter (raw \`<script>\`/\`<title>\` pass through unescaped).
- Heading anchor id algorithm: derive it empirically (punctuation, unicode, accents, emoji, inline code, links inside headings, duplicates -> suffix scheme, empty headings).
- The exact TOC markup produced by the reference for \`toc: true\` content (probe it: set \`toc: true\` in front matter and render \`{{ content.toc }}\`), including nesting style and which heading levels are included.

METHOD (do this, it matters more than speed):
1. Build a fast differential loop: a script that renders N case files through BOTH the reference and your implementation (via a scratch crate at {{SCRATCH}} that includes your files + a tiny main.rs reading stdin) and reports per-case diffs. Run it constantly.
2. Grow your own case list to 400+ cases as you find divergences; keep them in {{SCRATCH}}/cases/.
3. Iterate until the pass rate stops improving. Report the final pass rate honestly, and list the specific constructs that still diverge.
4. Put unit tests inside your files (\`#[cfg(test)] mod tests\`) for the trickiest cases.

Do NOT stop at "good enough": every divergence is a lost test in the benchmark. Time is not a constraint. Report your final numbers accurately.`;

phase('Implement')

const SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    passRate: { type: 'string', description: 'e.g. "412/430 cases" - be honest' },
    remainingDivergences: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['files', 'passRate', 'summary'],
}

const variants = [
  { key: 'md-impl-a', files: '/workspace/src/markdown/block.rs and /workspace/src/markdown/inline.rs', scratch: '/tmp/mdA' },
  { key: 'md-impl-b', files: '/tmp/mdB/block.rs and /tmp/mdB/inline.rs (write your final versions there; the integrator will diff both candidates and pick one)', scratch: '/tmp/mdB' },
]

const results = await parallel(variants.map(v => () => agent(
  PREAMBLE.replace('{{FILES}}', v.files).replaceAll('{{SCRATCH}}', v.scratch),
  { label: v.key, phase: 'Implement', schema: SCHEMA }
)))
return results.filter(Boolean)
