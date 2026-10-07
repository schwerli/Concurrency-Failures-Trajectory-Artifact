export const meta = {
  name: 'marmite-support-modules',
  description: 'Implement self-contained support modules (regex engine, unicode transliteration, HTTP server) for the marmite reimplementation',
  phases: [{ title: 'Implement', detail: 'regex, translit, http server' }],
}

const PREAMBLE = `You are helping build a from-scratch Rust reimplementation of a static site generator ("marmite"), located at /workspace. It is a REVERSE-ENGINEERING benchmark: behavior is observed from the reference binary /tmp/orig/marmite_ref only.

HARD RULES:
- NEVER decompile/disassemble/inspect the reference binary (no objdump/nm/readelf/strings/gdb/strace/ltrace, no grepping the binary file).
- NEVER look for the original project's source code. There is NO network access.
- You may run /tmp/orig/marmite_ref with inputs and read its outputs.

PROJECT CONSTRAINTS (critical):
- Rust 2021, std-only. NO external crates, ever (no network to fetch them). Do not add anything to [dependencies].
- Build with: cd /workspace && cargo build --release --offline
- Existing modules you can rely on: src/value.rs (Value/Map dynamic types), src/json.rs, src/yaml.rs, src/date.rs (DateTime + strftime), src/logger.rs, src/cli.rs, src/template/{parse,eval,filters,tests}.rs.
- Write clean, idiomatic, well-commented Rust. Match the existing style (module-level //! doc comment, no clippy-bait).
- Your module must compile on its own terms; other modules are still being written in parallel by other agents, so DO NOT edit files outside the ones assigned to you, and do NOT add \`mod\` declarations to src/main.rs (the integrator does that). Instead, verify your code compiles by creating a scratch crate under /tmp/<yourname>/ that copies in your file(s) plus any dependency files you need, with its own main.rs harness and unit tests. Report the exact commands you used.
- Put unit tests in a \`#[cfg(test)] mod tests\` block inside your file.

Report back: files written, what is covered, what is NOT covered, and how you verified.`;

phase('Implement')

const SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    verified: { type: 'string' },
    limitations: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['files', 'summary'],
}

const tasks = [
  { key: 'regex', prompt: `${PREAMBLE}

TASK: write /workspace/src/regex.rs - a small backtracking regex engine, std-only.

Public API (must match exactly, other modules depend on it):
\`\`\`rust
pub struct Regex { /* ... */ }
pub struct Captures<'t> { /* ... */ }

impl Regex {
    /// Compile a pattern. Returns Err(String) with a human-readable message on bad syntax.
    pub fn new(pattern: &str) -> Result<Regex, String>;
    pub fn is_match(&self, text: &str) -> bool;
    /// Leftmost match starting at or after \`start\` (byte offset).
    pub fn find_at(&self, text: &str, start: usize) -> Option<Captures<'_>>;
    pub fn find(&self, text: &str) -> Option<Captures<'_>>;
    /// All non-overlapping matches, left to right.
    pub fn find_iter<'t>(&self, text: &'t str) -> Vec<Captures<'t>>;
    pub fn replace_all(&self, text: &str, replacement: &str) -> String; // \$1, \${1}, \$0 supported
}

impl<'t> Captures<'t> {
    pub fn start(&self) -> usize;              // byte offset of whole match
    pub fn end(&self) -> usize;
    pub fn as_str(&self) -> &'t str;           // whole match
    pub fn get(&self, i: usize) -> Option<&'t str>;  // capture group i (0 = whole)
    pub fn len(&self) -> usize;                // number of groups + 1
}
\`\`\`

Syntax to support (this is the level the project needs):
- literals, \`.\` (any char except \\n by default), escapes \`\\\\. \\\\* \\\\( \\\\) \\\\[ \\\\] \\\\{ \\\\} \\\\| \\\\^ \\\\$ \\\\? \\\\+ \\\\- \\\\/ \\\\\\\\ \\\\n \\\\r \\\\t\`
- classes \`\\\\w \\\\W \\\\d \\\\D \\\\s \\\\S\` and \`[...]\` with ranges, negation \`[^...]\`, escapes inside, literal \`]\` first, and nested class escapes like \`[\\\\s\\\\S]\`
- groups: capturing \`( )\`, non-capturing \`(?: )\`, alternation \`|\`
- quantifiers: \`* + ? {n} {n,} {n,m}\` each with an optional lazy \`?\` suffix; applied to the preceding single element or group
- anchors \`^\` \`$\` (text start/end; also support multiline-ish \`$\` before a trailing newline is NOT required)
- must operate correctly on UTF-8 (match char-wise; offsets returned as BYTE offsets into the original &str)
- leftmost-first (backtracking, like Perl/regex crate's \`Regex\` for these constructs) semantics; lazy vs greedy must behave correctly.

The single most important pattern to get exactly right (it is the project's default shortcode pattern):
\`<!-- \\.(\\w+)(?:\\s+([^-][\\s\\S]*?))?\\s*-->\`
Test it against real inputs including: \`<!-- .youtube abc -->\`, \`<!-- .spoiler title=x\\nmultiline\\nbody -->\`, \`<!-- .name -->\`, \`<!-- not-a-shortcode -->\`, several shortcodes in one document (find_iter), and shortcodes with \`-->\` appearing inside the body.
Also test a decent set of general patterns and compare your results against python3's \`re\` module for the same patterns/inputs (python3 is available and \`re\` has the same leftmost-first backtracking semantics for these constructs) - write a script that fuzzes ~200 pattern/input pairs and compares. Report the pass rate.
Performance: must be fine for documents up to ~1 MB; avoid catastrophic behaviour by adding a simple step budget (return no-match after e.g. 5 million steps) - but do not let that trigger on normal inputs.` },

  { key: 'translit', prompt: `${PREAMBLE}

TASK: write /workspace/src/translit.rs - Unicode -> ASCII transliteration, so that our \`slugify\` matches the reference exactly.

Public API:
\`\`\`rust
/// Transliterate arbitrary Unicode text to ASCII, mapping each non-ASCII char
/// to its closest ASCII representation (possibly multiple chars, possibly empty).
pub fn to_ascii(text: &str) -> String;
\`\`\`

The reference implementation's slug algorithm is: transliterate to ASCII, lowercase, replace each run of non-alphanumeric characters with a single \`-\`, and trim leading/trailing \`-\`. YOUR JOB is to discover the transliteration table BY EXPERIMENT and encode it.

How to observe the reference's slugify:
1. \`mkdir -p /tmp/translit/in/templates\`
2. Write \`/tmp/translit/in/templates/content.html\` containing exactly: \`{{ content.title | slugify }}\`
3. Write markdown files with front matter \`---\\ntitle: "<TEST STRING>"\\nslug: probeN\\n---\\nbody\` (verify that \`slug:\` in front matter controls the OUTPUT FILE NAME so you can find the file; if it does not, discover how output names are derived and adapt).
4. Build: \`/tmp/orig/marmite_ref /tmp/translit/in /tmp/translit/out\` then read \`/tmp/translit/out/probeN.html\`.
Batch MANY test strings per build (many markdown files in one build) - aim for thousands of characters tested across a handful of builds. Write a python3 driver script for this.

Characters to cover systematically:
- Latin-1 Supplement + Latin Extended-A/B (U+00C0-U+024F): accented letters, ligatures (æ Æ œ Œ ß ø Ø đ ł), etc.
- General punctuation (U+2000-U+206F): dashes, quotes, ellipsis, primes, bullets
- Currency symbols, math symbols, arrows, fractions (½ ¼ ¾), superscripts/subscripts, ©®™°µ
- Greek and Cyrillic alphabets (upper+lower)
- CJK samples, Hiragana/Katakana samples, Hebrew/Arabic samples, Devanagari samples (record what happens - possibly dropped or transliterated)
- Emoji (record: dropped?)
- Combining marks / decomposed forms (e.g. "e" + U+0301) vs precomposed
Encode the DISCOVERED mapping as a static table in translit.rs. For ranges that are simply dropped, handle them by rule rather than by table. Keep the file well-organised and commented; a few thousand table entries is acceptable but prefer rules where they hold.

ALSO write, in the same file, a \`#[cfg(test)] mod tests\` with the exact observed (input -> expected slug) pairs for at least 100 interesting cases, testing a local copy of the slugify algorithm:
\`\`\`rust
fn slugify(text: &str) -> String { /* same algorithm as src/template/filters.rs::slugify */ }
\`\`\`
(Do not edit src/template/filters.rs - just replicate the algorithm inside your test module.)
Report: how many characters you probed, the fraction where a rule-based approach sufficed, and any character whose behavior you could not explain.` },

  { key: 'http', prompt: `${PREAMBLE}

TASK: write /workspace/src/server.rs - a minimal blocking HTTP/1.1 static file server, std-only (std::net::TcpListener + threads).

FIRST, observe the reference server's exact behavior (this defines the spec):
- Run \`/tmp/orig/marmite_ref <indir> <outdir> --serve --bind 127.0.0.1:<PORT>\` in the background on a site you generate. ALWAYS kill it when done. Pick unusual ports to avoid clashes with other agents (e.g. 18100-18199).
- With \`curl -i -sS\` capture: GET /, /index.html, /hello-world.html, /static/marmite.css, /static/favicon.ico, /nonexistent, /nonexistent.html, a subdirectory, a subdirectory without trailing slash, /static/ (directory listing?), HEAD requests, POST, HTTP/1.0 requests, a request with \`Connection: keep-alive\`, a path with %20 escapes, a path with \`..\` traversal, a very long path, a request for a file with no extension, an empty path, and a malformed request line (use printf | nc if available, else python3 socket).
- Record: exact status line text (e.g. \`HTTP/1.1 200 OK\`), the exact set + order + capitalisation of response headers, Content-Type for each extension (.html .css .js .json .xml .rss .md .txt .png .ico .woff .woff2 .svg .jpg .webp .pdf and unknown), Content-Length, whether the connection is kept alive, the exact 404 body, and what the process logs to stdout/stderr per request (exact format).
- Also record the exact startup log line(s) and what happens when the port is already in use, and when --bind is malformed.

THEN implement:
\`\`\`rust
/// Serve \`root\` over HTTP on \`bind\`, blocking forever. Errors from individual
/// connections are logged, not fatal.
pub fn serve(root: &std::path::Path, bind: &str) -> std::io::Result<()>;
\`\`\`
Match the observed status lines, headers, MIME types, 404 body, directory-index resolution and logging format as closely as you can. Handle concurrent connections (thread per connection is fine), and be robust to malformed requests.

Deliverables: /workspace/src/server.rs plus /tmp/probe/findings/server-spec.md documenting every observation above verbatim (exact bytes of headers). Verify your implementation by running it from a scratch crate under /tmp/http/ and diffing \`curl -i\` output against the reference for every case in your spec; report the diff results.` },
]

const results = await parallel(tasks.map(t => () => agent(t.prompt, { label: t.key, phase: 'Implement', schema: SCHEMA })))
return results.filter(Boolean)
