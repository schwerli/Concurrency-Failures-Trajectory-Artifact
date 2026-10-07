export const meta = {
  name: 'ditaa-explore',
  description: 'Black-box explore ditaa binary behavior across 11 feature areas in parallel',
  phases: [{ title: 'Explore', detail: '11 parallel area explorers writing specs to /workspace/notes' }],
}

const PREAMBLE = `You are reverse-engineering a compiled binary by BLACK-BOX OBSERVATION ONLY.

Binary: /workspace/executable  — it is "ditaa" version 0.11, a tool converting ASCII-art diagrams to PNG/SVG.
Docs you MAY read: /workspace/README.md (and /workspace/notes/*.md written by peers).

HARD RULES (violating these disqualifies the whole project):
- NEVER decompile, disassemble, or inspect the binary's bytes. No objdump/ghidra/gdb/nm/readelf/strings/xxd/od/grep on the binary. No strace/ltrace/perf.
- NEVER search the internet, and never look for / download / install the original ditaa source or jar (no apt, pip, mvn, curl, git clone).
- The ONLY allowed information sources are: running /workspace/executable with inputs+flags and observing its stdout/stderr/exit code/output files, plus /workspace/README.md.

How to run:
  /workspace/executable <INFILE> [OUTFILE] [options]
  --svg makes it write SVG (TEXT — reveals exact geometry; use this heavily)
  no --svg => PNG output.
Helpers already available:
  /workspace/tools/svg.sh <diagramfile> [extra args]   # prints the SVG for a diagram
  python3 /workspace/tools/pngread.py <file.png>       # decodes a PNG and prints an ASCII art view; module funcs read_png()/pixels()
Work ONLY in your own scratch dir: mkdir -p /tmp/<your-unique-name> && cd there. Never write outside it except your notes file and corpus files.

Ground truth already established (verify, don't just trust):
- cellW = (int)(10*scale), cellH = (int)(14*scale); default scale = 1.
- Image size: width = (cols+4)*cellW, height = (rows+4)*cellH  (a 2-cell margin on every side).
- Grid cell (col c, row r) spans x in [(c+2)*cellW, (c+3)*cellW]; its center x = (c+2)*cellW + cellW/2 (integer division). Same for y with cellH.
- PNG text is drawn with Java's default sans-serif BOLD (DejaVu Sans Bold) at size 15 for scale 1; SVG text says font-family='Courier' font-size='15'.
- A single "+" alone renders nothing; "+---+" renders a line only from col1 to col3 (the terminal "+" cells get dropped).

YOUR MISSION: produce a PRECISE and COMPLETE behavioral specification of your assigned area — detailed enough that an engineer can reimplement it exactly, byte-for-byte, without ever running the binary. Run MANY small focused experiments. Push on edge cases. Quote verbatim inputs and the verbatim relevant output lines. State rules as algorithms/formulas, not vibes. Where you could not determine something, say so explicitly and describe what you tried.

Deliverables:
1. Write your spec to /workspace/notes/<FILE>  (markdown, be thorough; long is fine).
2. Save interesting/tricky test diagrams as /workspace/corpus/<PREFIX>-<n>.txt (plain diagram text; these become regression fixtures).
3. Return a concise summary (max 45 lines) of the key rules you established.

YOUR ASSIGNED AREA:
`;

const AREAS = [
  { file: '01-cli.md', prefix: 'cli', label: 'cli', task: `Command-line interface and process behavior.
- Exact help/usage text (byte-exact) for: no args, --help, -h vs --html conflict, bad option, missing option value.
- Exit codes for every situation (success, missing input file, unreadable, bad scale, unknown option, output dir missing, etc).
- Exact stdout/stderr text for all of the above, including the version/copyright banner and the "Running with options:" block (which options are listed, in what order, and how values are shown). Test many combinations of flags to determine the exact ordering/format of that block.
- Default output filename rules when OUTFILE is omitted (for .txt input, for input with no extension, for .html input, with/without --svg).
- -o/--overwrite semantics: what happens when the output file already exists with and without -o (the help says an "alternative name is chosen" — determine the exact alternative-name algorithm).
- -e/--encoding: valid/invalid encoding names, behavior on invalid.
- -t/--tabs: numeric parsing, negative/zero/huge, non-numeric.
- -s/--scale: parsing of non-numeric, negative, zero, huge; what error appears.
- -b/--background parsing: 6-digit, 8-digit, with/without leading #, invalid lengths, invalid hex chars; error text.
- Argument order: options before/after positional args; more than 2 positional args; "-" as filename; reading from stdin if supported.
- -v/--verbose extra output.
- Behavior when input file is empty / directory / contains only whitespace.` },

  { file: '02-geometry.md', prefix: 'geom', label: 'geometry', task: `Text-grid preprocessing and global geometry.
- Confirm the cell size / margin / image size formulas for many scales (including fractional like 0.3, 1.25, 2.5, 7) and many grid sizes. Determine rounding exactly (truncate vs round) for cellW, cellH, stroke-width, font size.
- How are grid rows/cols determined: trailing blank lines, trailing spaces, lines of different length, leading blank lines, CR/LF vs LF, final newline missing, a file with a single blank line, a completely empty file (what happens? error? tiny image?).
- Tab expansion: default 8, with -t N; is expansion to fixed multiples of N (tab stops) or N literal spaces? Test tabs mid-line and at line start with several N.
- Non-ASCII / UTF-8 characters: are they treated as one cell? What does -e do (try UTF-8, ISO-8859-1, invalid)?
- Very long lines / many rows: any limits?
- Do trailing spaces affect image width? Do characters beyond some column get clipped?
- Determine exactly how the stroke width and font size scale with -s (test scale 1,2,3,0.5,1.5,2.5 and look at SVG stroke-width and font-size and PNG glyph size).
- Any special handling of the first/last row or column (e.g. shapes touching the boundary)?` },

  { file: '03-lines.md', prefix: 'lines', label: 'lines', task: `Line and edge semantics for open (non-closed) figures. This is the core of the algorithm — be exhaustive.
Characters involved: - | + / \\ = : and how they chain.
- Determine when a run of characters becomes a stroked path, and the exact endpoint coordinates. Explain the observed rule that terminal "+" cells are dropped ("+---+" -> line from col1..col3). Test: "++---++", "+-+", "-+-", "+", "++", "|" alone, "||", and vertical equivalents. Determine whether the drop is iterative.
- T-junctions and crossings: e.g. a "+" where a vertical and horizontal line meet; "-|-" ; a "+" in the middle of a long line with a vertical stub; two crossing lines; how many separate <path> elements are emitted and with what coordinates. Determine the ordering of emitted paths.
- Corners: "/" and "\\" as corners vs as diagonal lines. Are diagonals supported at all (e.g. a line of "\\\\\\\\")? What about "/" used mid-line?
- Dashed lines: "=" for horizontal, ":" for vertical. Determine propagation rules ("spreads" over the whole line), the exact stroke-dasharray value(s) and how they scale with -s, and what happens when a shape's boundary contains one "=" (does the whole closed shape become dashed?). Also test ":" in a horizontal line and "=" in a vertical line (should they be treated as text?).
- Determine when these characters are treated as TEXT instead of as lines (e.g. a lone "-" surrounded by letters, "a-b", "3+4", "x|y", "a:b", "a=b").
- Line joining across corners: does "+" in the middle produce one polyline or separate segments? Give exact SVG paths.
- Test an "L" shape, a "T", a "cross", a "staircase", a zigzag with / and \\.
Save every interesting diagram to the corpus.` },

  { file: '04-arrows.md', prefix: 'arrow', label: 'arrows', task: `Arrowheads and point markers.
- Arrowhead characters < > ^ v (also uppercase V?). Determine exact triangle coordinates for each direction at scale 1 and 2, and how the attached line is shortened/extended.
- When is a < > ^ v character an arrowhead vs plain text? (e.g. "a > b", "-->", "<--", ">" alone, ">" at start of a line of text, "x^2", "v" as a word, "vector", "1<2"). Determine the precise adjacency conditions.
- Arrowheads pointing INTO a box边 (e.g. "-->|" or "--->+"), arrowheads at both ends, double arrowheads "<-->", "<->", "><".
- Arrowheads on vertical lines, on dashed lines, on lines with color.
- Point marker "*": exact rendering (SVG output: circle? path?), radius, fill/stroke colors, at line ends vs middle vs on a box boundary; "*" alone; "*" in text ("a*b"); consecutive "**".
- Do arrowheads/markers inherit the line color? Test with color codes if you can (see README cRED etc).
- Determine SVG emission order relative to lines/shapes.
- Also test the o bullet-vs-marker interaction and "o" at a line end.` },

  { file: '05-shapes.md', prefix: 'shape', label: 'shapes', task: `Closed-shape detection, filling, nesting, and edge separation.
- Simple boxes with + corners and with / \\ round corners; mixed corners. Exact polygon point order and coordinates in SVG (note: SVG shows a shadow path then the filled path).
- Determine the exact rule for the shadow: which shapes cast shadows, the shadow's offset/geometry in SVG, and its ordering.
- Nested boxes (a box inside a box), adjacent boxes sharing an edge, boxes sharing a corner, boxes overlapping. Determine the "separation of common edges" behavior (default ON) vs -E: exactly how the geometry changes (compare SVG with and without -E). Quantify the separation offset.
- Round corners: -r flag vs "/"/"\\\\" characters. Exact quadratic curve control points, and how the radius scales with -s.
- What makes a shape "closed"? Test boxes with a gap, with a dashed edge, with a T-stub attached, with a line entering it, with text on the boundary.
- Big boxes containing lines/other shapes; a shape whose boundary is partially dashed.
- Ordering of emitted SVG elements when there are several shapes (is it sorted by area? by position?).
- -S (no shadows) effect on SVG/PNG.
- Determine the fill color of closed shapes (white by default) and whether open shapes are ever filled.
- Also determine z-order/painting order for nested shapes and text.` },

  { file: '06-markup.md', prefix: 'markup', label: 'markup', task: `Special shape markup tags: {d} document, {s} storage, {o} ellipse, {mo} manual operation, {c} decision/choice, {tr} trapezoid, {io} input/output.
- For each tag: minimal working example, exact SVG geometry produced (all path commands and numbers) at scale 1, and how it scales.
- Where must the tag appear (any position inside the shape? first line? must it be at a particular column?), and is it removed from the rendered text?
- What happens with an unknown tag like {x} or {} or {dd}? Is it left as text?
- Multiple tags in one shape; a tag in an open (non-closed) figure; a tag plus color code.
- The -W/--fixed-slope option: which shapes it affects and exactly how the geometry changes (compare SVG with/without -W for {io} and {tr} at several widths/heights).
- Determine whether tags affect the shadow shape too.
- Any other tags that seem to be recognized (try {mo},{tr},{io},{c},{o},{s},{d} plus guesses like {p},{e},{h}).` },

  { file: '07-colors.md', prefix: 'color', label: 'colors', task: `Color handling.
- The documented codes cRED cGRE cBLU cPNK cYEL cBLK: determine the EXACT RGB hex each produces (read the SVG fill attribute).
- Are there more 3-letter codes? Systematically try many 3-letter uppercase combos (e.g. cWHI, cORG, cGRA, cCYA, cMAG, cBRN, cLTR...). Report every one that is recognized (recognized = removed from text and changes the fill).
- Custom hex colors: try cXXX where XXX are hex digits, e.g. c00F, cF00, c123, cABC — determine whether 3-hex-digit colors are supported and the exact expansion to 6-digit RGB.
- Where must the code appear (inside a closed shape? anywhere in the shape's cells? multiple codes -> which wins?). Is the code removed from the text?
- Effect on text color inside a colored shape: does ditaa switch text to white on dark backgrounds? Determine the exact luminance rule by testing many colors and reading the SVG text fill.
- Color codes applied to lines/open shapes: do they color the stroke?
- The shadow color for colored shapes.
- Stroke color of colored shapes (is the outline black or a darker shade of the fill?).
- Interaction with -T/-b options.` },

  { file: '08-text.md', prefix: 'text', label: 'text', task: `Text handling and placement.
- Which grid characters end up as text vs consumed as drawing. Determine how contiguous text runs are grouped into one <text> element (are spaces inside a run kept? how many spaces split a run?).
- The exact x and y coordinates of a <text> element as a function of its start column/row, scale, and content. Derive a formula and verify across scales 1,1.5,2,2.5,3 and columns/rows.
- Font size in SVG vs PNG for each scale; is the PNG font size (int)(15*scale) or something else? Verify by measuring rendered glyph heights in PNG at scale 2,3.
- Bullet points: the ' o ' rule from the README. Exact geometry of the bullet (SVG element, radius) and the effect on the remaining text and its x position. Test 'o' at start of line, 'o' with only one adjacent space, 'oo', ' o' at end of line.
- Text containing characters that look like drawing chars (a-b, a|b, a+b).
- Text with color codes / tags removed: verify the leftover text and its position (does the removal shift the text?).
- Text that overlaps a shape boundary or sits outside any shape.
- Text alignment relative to shapes: is text ever centered in a box? (Probably not — verify.)
- Non-ASCII text and CDATA escaping in SVG (test <, >, &, ]]>, quotes).
- Determine the SVG text element attribute order and exact formatting.` },

  { file: '09-svg.md', prefix: 'svg', label: 'svg', task: `Exact SVG serialization format (this must be byte-exact).
- Full byte-exact structure of the SVG file: XML declaration, root element attributes and their order/indentation/quoting, the <defs> filter block, the <g> element attributes, closing tags, trailing newline. Give a verbatim template.
- Number formatting: are coordinates printed as Java doubles ("25.0")? integers for width/height? Determine per-attribute formatting. Find a case producing a non-integral coordinate to see how it is printed (e.g. odd scale, ellipse, curve control points).
- The background <rect>: color format, and what --transparent / -b RRGGBB / -b RRGGBBAA do to it (test 8-digit alpha).
- --svg-font-url <FONT>: exact effect on output (what element/attribute appears, where).
- -A (no antialias), -d (debug grid), -S (no shadows), -E: their effect on SVG output specifically (debug grid in SVG?).
- The shadow filter: exact defs content, and whether it changes with scale (dx/dy/stdDeviation).
- Element emission order for a complex diagram (shadows first? all shadows then all shapes? text last?). Establish the sorting/ordering rule with a diagram containing several shapes, lines, arrowheads, markers and text.
- Determine the exact output when the diagram is empty.
- Does --svg with a .png OUTFILE still write SVG? Does no --svg with .svg OUTFILE write PNG? (i.e. is the format chosen by flag or extension?)` },

  { file: '10-png.md', prefix: 'png', label: 'png', task: `PNG raster output specifics. Use python3 /workspace/tools/pngread.py (functions read_png/pixels) to examine pixels.
- PNG chunk structure, color type, bit depth for: default, --transparent, -b with 8-digit alpha, -A. (Does transparency switch to RGBA/colortype 6?)
- The drop shadow: determine the EXACT algorithm. Measure the gradient profile of the shadow around an isolated horizontal line and an isolated box (e.g. render a 1-cell-tall line and read the pixel values below it). Deduce: shadow offset (dx,dy) in pixels, the blur kernel (looks like a linear ramp => box blur; find its exact width and whether it is separable/how many passes), the shadow color/alpha, and how all of this scales with -s. Note that the background far from any shape was 255 but near shapes 254 — explain why (kernel normalization? a 1/255 tail?) and give exact numbers.
- Antialiasing: which primitives are drawn antialiased; what -A changes exactly (compare pixel values).
- The debug grid -d: exact colors, line positions, and stroke widths; how it interacts with scale.
- Whether the image is drawn in the same order as the SVG elements.
- Background: -b RRGGBB, -b RRGGBBAA, -T; exact resulting pixel values (including whether alpha is premultiplied).
- Determine the exact color used for the shadow (SVG says 'gray').
- Report exact pixel dumps for at least: a 1-cell line, a small box, a small box with -S, with -A, with -d, with -T.` },

  { file: '11-html.md', prefix: 'html', label: 'html', task: `HTML mode (-h/--html) and file-naming behavior.
- Construct HTML inputs with <pre class="textdiagram"> blocks and determine: output HTML file name, the images directory name/location, the generated PNG file names (with and without an id attribute), the exact <img> tag emitted (attributes, order), and what the rest of the HTML looks like (is it re-serialized or copied verbatim? Determine exactly).
- Case sensitivity of the tag/class/id attributes; extra attributes on <pre>; multiple diagrams; nested tags inside <pre>; HTML entities inside the pre block (&amp; &lt; etc) — are they decoded before rendering?
- Skipping existing files and the --overwrite behavior.
- What happens with no matching <pre> tags, malformed HTML, or a non-HTML file.
- Does --svg work with --html?
- Interaction with the OUTFILE positional argument.
- Exact stdout messages in html mode (with and without -v).` },
];

phase('Explore')
const results = await parallel(AREAS.map(a => () =>
  agent(PREAMBLE + a.task + `\n\nWrite your notes to /workspace/notes/${a.file} and name corpus files /workspace/corpus/${a.prefix}-<n>.txt`,
    { label: a.label, phase: 'Explore' })
));
return AREAS.map((a, i) => ({ area: a.label, summary: results[i] }));
