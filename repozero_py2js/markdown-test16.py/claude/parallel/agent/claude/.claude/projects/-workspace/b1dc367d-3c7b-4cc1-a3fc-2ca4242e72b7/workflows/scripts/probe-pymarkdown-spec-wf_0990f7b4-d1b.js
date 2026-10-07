export const meta = {
  name: 'probe-pymarkdown-spec',
  description: 'Fan out probing agents to reverse-engineer Python-Markdown 3.10.2 core behavior from a black-box executable, then adversarially refine each spec',
  phases: [
    { title: 'Probe', detail: 'one agent per construct area, empirically mapping rules' },
    { title: 'Refine', detail: 'adversarial edge-case hunt against each area spec' },
  ],
}

const BT = String.fromCharCode(96)
const BT3 = BT + BT + BT

const HOWTO = `
You are reverse-engineering the exact behavior of Python-Markdown 3.10.2 (\`markdown.markdown(text)\`, CORE ONLY, no
extensions, output_format='xhtml') by black-box probing a precompiled executable. You may NOT read Python source.

TOOLING (already built, use it):
  node /workspace/tools/probe.mjs -e 'line1\\nline2'     -> converts ONE snippet (backslash escapes \\n \\t interpreted),
                                                            prints INPUT_JSON / OUTPUT_JSON / OUTPUT_RAW
  node /workspace/tools/probe.mjs --file snips.json      -> BATCH: file holds a JSON array of strings; prints JSON
                                                            [{input, output}]. STRONGLY PREFER THIS - one process per
                                                            snippet is slow (~1s each), so batch 30-60 snippets per call.
  node /workspace/tools/probe.mjs --full a b c d e        -> the whole 5-arg program output

Write your batch files under /workspace/probes/<yourarea>-N.json (mkdir -p first). Build them with a heredoc or with
node -e writing JSON, so newlines/quotes survive exactly.

CRITICAL CONSTRAINT ON THE VALUES YOU PROBE: the executable uses argparse, so a snippet that starts with '-' and
contains NO space (e.g. '---', '-x') is rejected as an unknown option. Work around it by putting a leading newline
(e.g. '\\n---') or a space, and note the workaround in your report - do not report it as a markdown behavior.

YOUR JOB: produce an implementation-grade specification of your assigned area, precise enough that another engineer can
reimplement it in JavaScript WITHOUT any regular expressions (manual character scanning only) and match Python-Markdown
byte for byte. That means:
  - State the ALGORITHM (scan order, what terminates a construct, precedence vs other constructs), not just examples.
  - Give exact output strings including newline placement (the serializer inserts newlines in specific places).
  - Probe the boundaries: 0/1/2/3/4+ spaces of indentation, tabs, blank lines, EOF without trailing newline, empty
    content, unicode (CJK) content, interaction with adjacent constructs, malformed input.
  - Every rule you state MUST be backed by at least one probe you actually ran. Never guess. If you are unsure, probe.
  - Report verbatim JSON input/output pairs for the decisive cases (use the OUTPUT_JSON form so whitespace is visible).
Budget: run at least 150 distinct probe snippets. Be exhaustive; token cost is not a concern.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'algorithm', 'rules', 'examples', 'gotchas'],
  properties: {
    area: { type: 'string' },
    algorithm: { type: 'string', description: 'Step-by-step algorithm an implementer can follow, incl. precedence and termination conditions. Be detailed; multi-paragraph is expected.' },
    rules: { type: 'array', items: { type: 'string' }, description: 'Atomic, testable rules. Each backed by a probe.' },
    examples: {
      type: 'array',
      description: 'Decisive verbatim probe results, JSON-escaped exactly as printed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'output'],
        properties: { input: { type: 'string' }, output: { type: 'string' }, note: { type: 'string' } },
      },
    },
    gotchas: { type: 'array', items: { type: 'string' }, description: 'Surprising/counter-intuitive behaviors that a naive CommonMark-style implementation would get wrong.' },
  },
}

const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['corrections', 'newRules', 'newExamples'],
  properties: {
    corrections: { type: 'array', items: { type: 'string' }, description: 'Rules from the draft spec that are WRONG or incomplete, with the probe that disproves them.' },
    newRules: { type: 'array', items: { type: 'string' }, description: 'Additional verified rules the draft missed.' },
    newExamples: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['input', 'output'],
        properties: { input: { type: 'string' }, output: { type: 'string' }, note: { type: 'string' } },
      },
    },
  },
}

const AREAS = [
  { key: 'pipeline', prompt: `AREA: whole-document pipeline & whitespace normalization.
Cover: empty string and whitespace-only input (what exactly is returned?); tab expansion (tab_length=4, is it expandtabs semantics i.e. tab stops, or 4 literal spaces? probe 'a\\tb', '\\ta', 'ab\\tc', 'abc\\td', 'abcd\\te'); CRLF and lone CR;
lines containing only spaces between blocks; leading blank lines; trailing newlines/spaces; how many trailing newlines the result has (result appears .strip()ed - confirm);
the top-level newline placement BETWEEN sibling blocks; whether output ever ends with a newline; NUL/control chars; \\x02/\\x03 (STX/ETX) in input;
document consisting of a single line vs many; what separates two paragraphs in output.` },

  { key: 'paragraph', prompt: `AREA: paragraphs and line breaks.
Cover: multi-line paragraph joining (are interior newlines preserved verbatim?); leading/trailing spaces on each line; a paragraph line indented 1-3 spaces; 4+ spaces (becomes code) and what happens when the FIRST line is indented 4 spaces vs a later line;
two trailing spaces -> <br />, exact placement of the newline after <br />; 1 space, 3 spaces, tab at end of line; trailing spaces on the LAST line of a paragraph; backslash at end of line;
paragraph immediately followed by a heading/list/quote/hr with no blank line (lazy continuation); a paragraph that is only spaces; CJK text.` },

  { key: 'atx', prompt: `AREA: ATX headings (#).
Cover: levels 1-6 and 7+; '#Hi' with no space; '#' alone; '###' alone; trailing closing hashes with/without space; trailing hashes mixed with text; leading 1/2/3/4 spaces;
'#' followed by only spaces; inline markup inside heading; heading immediately after a paragraph line with no blank line; heading directly followed by text on the next line;
trailing whitespace; '#\\ttext'; hashes inside the text; empty heading output form (<h1></h1> vs <h1 />).` },

  { key: 'setext', prompt: `AREA: setext headings (=== / ---) and how they compete with hr, lists and paragraphs.
Cover: 'Title\\n===' and '\\n---' underlines of length 1,2,3+; underline with leading/trailing spaces; multi-line paragraph before the underline (which lines become the heading?);
'---' after a blank line (hr instead); setext underline directly after a list item; text then '===' then more text; '=' inside a paragraph; a line of '-' following a paragraph line vs following a blank line;
'Title\\n---\\nmore text'. Determine the exact precedence order between setext, hr, and list processing.` },

  { key: 'code', prompt: `AREA: indented code blocks.
Cover: 4-space indent, 5+ spaces (extra preserved), tabs; blank lines INSIDE a code block and whether trailing blank lines are stripped; consecutive code blocks separated by 1 or 2 blank lines (merged or separate?);
exact output form: <pre><code>...</code></pre> and the newline before </code>; HTML-escaping inside code (&, <, >, ", '); existing entities inside code (&amp; -> ?);
backslashes inside code; a code block at the very start vs after a paragraph (no blank line between paragraph and indented line!); code block inside a list item; CJK; a code block whose last line has trailing spaces.` },

  { key: 'quote', prompt: `AREA: blockquotes.
Cover: '>' with and without a following space; '>' alone (empty quote); lazy continuation lines without '>'; blank line inside a quote with and without '>'; nested '> >' quotes;
quote containing a heading/list/code block/hr; two quotes separated by a blank line (merged or separate?); a quote immediately after a paragraph with no blank line;
'>' indented 1-3 and 4 spaces; exact output newline placement for <blockquote>. Also probe '\\n>quoted' style where the > is the first char of the doc.` },

  { key: 'ulist', prompt: `AREA: unordered lists.
Cover: markers '-', '+', '*'; changing the marker mid-list (new list or same?); required space after the marker ('-a' vs '- a'); marker with 1-3 leading spaces; 4+ spaces;
tight vs loose lists - THE KEY QUESTION: exactly when does an <li> get a wrapping <p> and when is the text bare? probe blank lines between items, blank line before the last item only, multi-paragraph items;
continuation lines (lazy, and indented 1,2,3,4,5,8 spaces); nested lists at 2,3,4,5,6,8 spaces of indent; an item containing an indented code block (note the surprising result seen earlier: a 4-space-indented block after a blank line inside a list became a PARAGRAPH, not code - map that rule exactly);
item containing a blockquote/heading; empty item ('-' alone, '- ' alone); list immediately after a paragraph with no blank line; exact newline placement in <ul>/<li> output.` },

  { key: 'olist', prompt: `AREA: ordered lists.
Cover: '1.' '2.' arbitrary/non-sequential numbers (does the output ever carry a start attribute?); starting at 0 or 5 or 99; '1)' form; multi-digit; required space after the dot;
switching between ordered and unordered mid-list; ordered list nested in unordered and vice versa at various indents; tight/loose <p> wrapping (same questions as ulist);
a paragraph line that begins with a number+dot (e.g. '1986. What a year' - does it become a list?); indentation of continuation lines relative to a 2-char marker ('1. ' is 3 chars).` },

  { key: 'hr', prompt: `AREA: horizontal rules.
Cover: '---', '***', '___', with 3,4,10 chars; spaces between the chars ('- - -', '* * *', ' ---'); leading 1,2,3,4 spaces; trailing spaces/text after;
mixed characters; hr with only 2 chars; hr directly after a paragraph line with no blank line (vs setext); hr inside a list/quote; the exact serialized form (<hr /> vs <hr>) and surrounding newlines;
hr as the first/last thing in the document. Remember to prefix with '\\n' to get past argparse.` },

  { key: 'emphasis', prompt: `AREA: emphasis and strong emphasis.
Cover: *em*, _em_, **strong**, __strong__, ***both***, ____, *****; intraword: 'a*b*c', 'a_b_c', 'snake_case_word', 'do__ble__under';
unmatched/odd numbers of markers; markers with spaces inside ('* not em *', '** x **'); nesting ('*a **b** c*', '**a *b* c**'); adjacent runs ('*a**b*'); escaped markers;
emphasis spanning a newline inside a paragraph; emphasis touching punctuation and CJK characters (does _ work between CJK chars?); '*' at line start (list conflict);
'a*b' single marker; '**a*' mismatched. Report the precedence/scan order of the em/strong patterns as precisely as you can.` },

  { key: 'codespan', prompt: `AREA: inline code spans (backticks) - HIGH PRIORITY, the sample tests depend on it.
Let B mean a single backtick character.
Cover: single B pairs; double/triple/quadruple B fences (n opening backticks close with exactly n, not fewer/more); content spanning multiple newlines inside a paragraph
(a triple-backtick "fence" is parsed as an inline code span, since fenced_code is an extension and is NOT enabled!);
whether leading/trailing spaces inside the span are stripped; an empty span (two adjacent backticks); the case B B space B space B B (double-fence containing a lone backtick);
a lone unmatched backtick; an escaped backtick (backslash then backtick); HTML escaping inside a span (&, <, >, double quote, single quote); named/numeric entities inside a span;
a backtick run at the very start of a paragraph; TWO fence-like blocks in the same paragraph separated by other text - reproduce and explain the strange nested
'<code></code>bash' output shown in the task description's Test Case 3; what happens across a blank line (spans cannot cross block boundaries);
a ${BT3}lang / code / ${BT3} block as its OWN paragraph vs joined with other lines into one paragraph.
Explain the exact matching algorithm, including how the opening run is chosen, how many characters are consumed, and what happens to unmatched leftovers.` },

  { key: 'links', prompt: `AREA: links, images, autolinks, reference links.
Cover: [t](url), [t](url "title"), [t](url 'title'), [t](<url>), empty url [t](), url with spaces/parens/nested parens, url with & and " (how are they escaped in the attribute?);
titles containing quotes; ![alt](src "t") image attribute ORDER in the output (looks alphabetically sorted - confirm and state the rule for <a> too);
reference links [t][id], [t][], [t] with a definition; definition syntax variants ('[id]: url', '[id]: url "title"', title on the next line, indented definitions, case-insensitivity of ids, where definitions may appear, whether the definition line vanishes from the output);
undefined reference (output verbatim?); autolinks <http://x>, <https://x>, <mailto:a@b>, <a@b.com> (email obfuscation via entities! probe it), <not a url>;
nested brackets [a [b] c](u); escaped brackets; a link containing emphasis and code; bare URLs (should NOT autolink in core).` },

  { key: 'rawhtml', prompt: `AREA: raw HTML - block-level and inline - HIGH PRIORITY, Test Case 3 depends on it.
Cover: a block-level element (<div>, <html>, <p>, <table>, <pre>) starting at column 0 in its own block - is the inside processed as markdown? is it re-indented? preserved verbatim?;
unclosed block tag; a block tag with text before/after it on the same line; blank lines INSIDE a raw html block; nested block tags; inline tags (<em>, <span>, <b>) inside a paragraph;
a lone '<' , '<5', '<foo' that is not valid HTML, unknown/custom tags (<mytag>); void elements (<br>, <hr>, <img>) - are they normalized to <br />?; attribute quoting preserved verbatim?;
HTML comments at block level and inline (including multi-line); processing instructions; declarations like <!DOCTYPE html>; CDATA; <script>/<style> content (markdown-processed or not?);
markdown constructs INSIDE a raw html block (e.g. <div> newline *em* newline </div>, and with blank lines around); the exact newline placement around a restored raw block;
a raw html block indented 1-3 spaces and 4 spaces. Explain how the raw html is stashed and reinserted, and what the surrounding <p> tags look like (Test Case 3 shows a paragraph containing three backticks plus 'html' followed by a verbatim <html> block).` },

  { key: 'escapes', prompt: `AREA: backslash escapes, ampersands, entities, and the final HTML escaping pass.
Cover: which characters are escapable - probe a backslash followed by each of these: backslash, backtick, asterisk, underscore, brace open/close, bracket open/close, paren open/close, hash, plus, minus, dot, bang, less-than, greater-than, pipe, colon, double quote, single quote, slash, equals, tilde, caret, percent, dollar, at, comma, semicolon, question mark - and also a backslash before a letter, a digit, a newline, and a CJK character;
a backslash at end of input; double backslash; escapes inside code spans, code blocks, link urls and titles, and headings;
bare ampersand -> &amp;; '&amp;' left alone; '&copy;' left alone; '&#65;' and '&#x41;' left alone; '&notanentity;' (escaped or not?); '&#;'; an ampersand followed by a space; '<' and '>' in text -> &lt; &gt;; double quote in text (escaped or not?); single quote;
'&amp;amp;' double-encoded. State the precise rule for when an ampersand becomes &amp;.` },

  { key: 'nesting', prompt: `AREA: deep nesting and construct interaction (the integration cases).
Cover: list inside quote, quote inside list, code block inside quote, heading inside list, hr inside list item, nested list 3 levels deep, list -> quote -> list;
the exact indentation/newline layout of the serialized nested output; a table-like pipe block (pipes get NO special treatment in core - confirm with '| a | b |\\n| - | - |');
a document mixing every construct; very long lines; a construct interrupted by EOF mid-way; blank-line-separated sibling blocks vs adjacent ones;
what happens when a list item's continuation is indented enough to be BOTH a nested list and a code block. Also probe the exact behavior when a block is indented by exactly 4 spaces inside a list item at various nesting depths.` },

  { key: 'argparse', prompt: `AREA: the command-line interface (argparse) - NOT markdown.
The program is: argparse.ArgumentParser(description="Large scale markdown processing") with five required str options --a --b --c --d --e.
Probe /workspace/dataset/test16_executable DIRECTLY (not probe.mjs) and report EXACT stdout/stderr bytes and exit codes for:
no args; some args missing (note the order the missing ones are listed); --a with no value; '--a=value' form; '--a=' (empty value); repeated '--a x --a y' (last wins?);
unknown option '--z v'; a value that starts with '-' and has no space ('--a -x', '--a ---', '--a -5', '--a -5.5', '--a -'); a value starting with '-' that CONTAINS a space ('--a "- item"');
prefix abbreviation (is '--a' unambiguous? try '-a', '--A', '--aa'); '-h' and '--help' (full text, exit code); '--' separator ('--a -- --b x'); extra positional args;
empty string value '--a ""'; a value containing '=' or newlines; argument order shuffled. Report the exact 'usage:' line and error message templates verbatim, including the program name used and whether output goes to stdout or stderr.` },
]

phase('Probe')
log(`Probing ${AREAS.length} behavior areas against Python-Markdown 3.10.2 (core, xhtml)`)

const specs = await pipeline(
  AREAS,
  (a) => agent(`${HOWTO}\n\n${a.prompt}`, { label: `probe:${a.key}`, phase: 'Probe', schema: SCHEMA }),
  (spec, a) => {
    if (!spec) return null
    return agent(
      `${HOWTO}\n\nAREA: ${a.prompt}\n\n` +
      `Another engineer produced this DRAFT SPEC for the area. Your job is ADVERSARIAL: assume it contains errors and ` +
      `omissions, and find them by probing. Specifically:\n` +
      `  1. Re-run the decisive examples and confirm the outputs are byte-accurate (they may have been transcribed wrong).\n` +
      `  2. For each stated rule, construct the input most likely to break it. Probe it.\n` +
      `  3. Hunt for cases in this area the draft never considered, especially interactions with OTHER constructs, ` +
      `unicode/CJK input, and off-by-one indentation.\n` +
      `Run at least 100 additional probe snippets. Report only VERIFIED corrections and additions - every claim needs a probe.\n\n` +
      `DRAFT SPEC:\n${JSON.stringify(spec, null, 1)}`,
      { label: `refine:${a.key}`, phase: 'Refine', schema: REFINE_SCHEMA }
    ).then((r) => ({ ...spec, refinement: r }))
  }
)

const ok = specs.filter(Boolean)
log(`Collected ${ok.length}/${AREAS.length} refined specs`)
return { specs: ok }
