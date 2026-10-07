export const meta = {
  name: 'codesnap-discovery',
  description: 'Fan out probes of the codesnap reference binary to document its complete behavior',
  phases: [
    { title: 'Probe', detail: '14 agents each probe one behavioral area of ./executable' },
  ],
}

const PREAMBLE = `
You are reverse-engineering a compiled CLI binary at /workspace/executable (version string: "codesnap-cli 0.13.1").
It generates code-snapshot images. A teammate will write an original Rust reimplementation from your findings.

## HARD RULES (violating these fails the whole project)
- You may ONLY learn about the binary by RUNNING it with different arguments/inputs and observing
  stdout, stderr, exit codes, and the files it writes.
- FORBIDDEN: objdump, nm, strings, readelf, gdb, strace, ltrace, ldd, hexdump/xxd/od on /workspace/executable,
  any decompiler or disassembler, reading the binary's bytes in any way (no \`cat\`, no python open() on it).
  The file is mode ---x--x--x so you cannot read it anyway - do not try.
- FORBIDDEN: searching the web, cloning repos, package managers (cargo/pip/npm/apt) to obtain the
  original source. There is NO network access anyway.
- Reading /workspace/README.md, /workspace/LICENSE, and files the binary itself creates is allowed.

## ENVIRONMENT
- Use an isolated HOME so you do not race other agents over the shared config file:
  export HOME=/tmp/probe/$AGENT   (mkdir -p it first).  The binary auto-creates
  \$HOME/.config/codesnap/config.json on first run and prints an INFO line about it.
- Work in your own scratch dir /tmp/probe/$AGENT/work.
- A PNG analysis toolkit is at /workspace/notes/pngtool.py. Commands:
    python3 /workspace/notes/pngtool.py info F...            # dims, colortype
    python3 /workspace/notes/pngtool.py px F X Y [X Y ...]   # pixel hex
    python3 /workspace/notes/pngtool.py row F Y [X0 X1]      # run-length row scan
    python3 /workspace/notes/pngtool.py col F X [Y0 Y1]      # run-length column scan
    python3 /workspace/notes/pngtool.py uniq F [N]           # most common colors
    python3 /workspace/notes/pngtool.py diff A B             # pixel diff bbox
    python3 /workspace/notes/pngtool.py art F [X0 Y0 X1 Y1 [COLS]]  # ascii art
  Use --scale-factor 1 for small, easy-to-analyze images.
- Useful facts already established (do not re-derive, but do sanity check if relevant):
  - \`--type ascii\` refuses any output except clipboard; clipboard fails here (no X11).
  - Output extension must be .png, .svg, or .html, else "Unsupported output format" (exit 1).
  - .svg output = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="data:image/png;base64,BASE64"/></svg>'
  - .html output = '<img src="data:image/png;base64,BASE64" />'
  - Default window bg is #282a36; default background is a horizontal gradient #6bcba5 -> #caf4c2.
  - At --scale-factor 1, default margins are 82/82; a one-line snapshot with the mac window bar
    is 518x308 total and the window box occupies y=82..153 (72px tall).
  - Log lines are colored: INFO uses ESC[34m, WARN ESC[33m, ERROR ESC[31m, SUCCESS ESC[32m, then ESC[0m.
    Capture the EXACT bytes with \`... 2>&1 | od -c | head\` when the exact escape/format matters.
  - Every distinct message must be recorded verbatim, including punctuation and trailing text.

## YOUR OUTPUT
Write a thorough, precisely-worded markdown report to the file path given below. Include exact
command lines and exact observed output for every claim. Prefer tables of measurements. Where you
infer a formula, give the data points that support it and note where it breaks down.
Then return (as your final message) a compact summary of the key conclusions - at most 60 lines.
Be exhaustive in the FILE, concise in the return value.
`;

const AREAS = [
  {
    id: 'cli-surface',
    file: '/workspace/notes/01-cli-surface.md',
    task: `Document the complete argument-parsing surface (it is clap-based).
- Capture \`-h\`, \`--help\`, \`-V\`, \`--version\` output byte-exactly (use od -c to check trailing newlines).
- For EVERY flag in --help, determine: does it take a value? is the value optional (e.g. \`-c [<Code>]\`,
  \`-i [<Image>]\`)? can it repeat? is it multi-valued (\`-e\`, \`-d\`, \`-a\` show \`...\`)? What happens with
  the flag but no value; the flag twice; the flag with an empty value?
- Determine the exact clap error text + exit code for: unknown flag (--foo), unknown short (-z),
  missing required --output, bad value for --mac-window-bar / --has-breadcrumbs / --type (enum),
  non-numeric --scale-factor / --margin-x / --start-line-number / --shadow-radius, negative numbers,
  huge numbers, \`--\` separator, a bare positional argument, "--help" combined with other args,
  ambiguous prefix (e.g. --from), and suggestions ("tip: a similar argument exists").
- Determine which value types are accepted: is --scale-factor a float or int? --margin-x float or int?
  Try 1.5, -1, 0, 1e3, 999999.
- Determine the exact "Usage:" line clap prints in error cases and whether it varies with which args
  were supplied (it does - e.g. it echoed "Usage: codesnap --output <OUTPUT> --from-code [<Code>]").
  Map out that behavior carefully with several arg combinations.`,
  },
  {
    id: 'runtime-errors',
    file: '/workspace/notes/02-runtime-errors.md',
    task: `Enumerate every runtime (non-clap) error/warning/info message, its exact text, and exit code.
Known so far: "No code snippet provided", "No such file or directory (os error 2)",
"Unsupported output format", "Cannot find <X> theme", "ASCII snapshot only supports copying to clipboard",
"Unknown error while interacting with the clipboard: ...", "Automated created config file at \\"...\\"",
"Snapshot saved to <path> successful!".
Find the rest by probing: unreadable file (chmod 000), directory as -f, binary/non-UTF8 file as -f,
empty file, output path in a nonexistent directory, output path that is a directory, output path
without write permission, invalid --range strings, invalid --raw-highlight-lines JSON, invalid color
strings for every *-color option and --background, invalid --config path, malformed config JSON,
config with wrong types, unknown language, unknown font family, --from-image with a missing/invalid
image, -e with a failing command / nonexistent command, --start-line-number 0, negative ranges,
range out of bounds, --highlight-range out of bounds, -d/-a out of bounds.
For each: record the full stderr/stdout, which stream it goes to, and the exit code.
Also determine what --silent suppresses (which messages disappear) and whether errors still print.`,
  },
  {
    id: 'inputs',
    file: '/workspace/notes/03-inputs.md',
    task: `Document all input sources and their precedence.
- \`-f/--from-file\`: relative/absolute paths, ~ expansion, trailing newline handling, CRLF handling,
  tabs, files with no trailing newline, empty file, file with only newlines, very long lines.
- \`-c/--from-code\`: value optional - what happens with \`-c\` alone (does it read stdin?). Test
  \`echo hi | ./executable -c -o out.png\` and \`./executable -c -o out.png < file\`. Test multiline values.
- \`-e/--execute\`: how are multiple words handled? Is it run through a shell? Does it capture stderr?
  What is the resulting code snippet exactly (is the command line itself included as a first line?)?
  Test \`-e echo hi\`, \`-e "echo hi"\`, \`-e ls -la\`, a failing command, a command producing ANSI colors.
  Then test \`--skip\` with the same commands (docs: "Skip run the command to get output, just take
  the command as the input").
- \`--from-clipboard\` and \`-i/--from-image\`: what errors appear (no X11 here). For --from-image, create
  a small PNG with python and see if it is accepted; find out whether the image is used as the snapshot
  content and how it affects dimensions.
- Precedence: supply two or more of -f/-c/-e/--from-clipboard together; which wins? Any error?
- \`--file-path\` vs \`-l/--language\` vs \`-f\`: which one drives language detection? Does --file-path need
  to exist? Does it affect breadcrumbs?
- Does the tool read stdin at all when no input flag is given?`,
  },
  {
    id: 'outputs',
    file: '/workspace/notes/04-outputs.md',
    task: `Document output handling exhaustively.
- Extension matching: case sensitivity (.PNG, .Svg), multiple dots, no extension, dotfiles,
  ".png" as the whole name, paths with spaces, relative vs absolute, nonexistent parent dir,
  existing file (overwrite?), output = "clipboard" literal (with --type image, what error?),
  a directory path and a directory path with trailing slash.
- Capture the exact success message format for each case, including how the path is rendered
  (as given? canonicalized? quoted?).
- SVG wrapper: capture the EXACT full text around the base64 (prefix and suffix bytes) with head -c/tail -c.
  Confirm whether there is a trailing newline. Same for HTML.
- Verify that the PNG embedded in the .svg / .html is byte-identical to the .png produced for the same
  input (compare base64-decoded bytes with the .png bytes; use python3 to decode).
- Inspect the PNG structure: chunk list and order, bit depth, color type, whether there is an alpha
  channel with non-255 values anywhere (e.g. rounded outer corners), interlacing, any text chunks.
  Determine the exact set of chunks so a reimplementation can match.
- Check whether the PNG's IDAT is deflate-compressed with a particular zlib header (first 2 bytes of
  IDAT) and what compression level that implies. Report the first bytes of IDAT.
- Test --silent with a successful run and confirm exactly which lines vanish.`,
  },
  {
    id: 'config-schema',
    file: '/workspace/notes/05-config-schema.md',
    task: `Reverse-engineer the JSON config file schema and its interaction with CLI flags.
The auto-created default is (verbatim, 2-space indent, trailing newline unknown - CHECK with od):
{"print_eggs": false, "snapshot_config": {theme, window{mac_window_bar, shadow{radius,color},
margin{x,y}, border{width,color}, title_config{color,font_family}, radius}, code_config{font_family,
breadcrumbs{enable,separator,color,font_family}}, watermark{content,font_family,color}, background{
start{x,y}, end{x,y}, stops[{position,color}]}}}
Tasks:
- Capture the auto-created file byte-exactly (od -c the tail to check trailing newline). Confirm key
  ORDER and indentation.
- Determine when it is created (only if missing? if the dir is missing? what if the file is invalid?).
- Determine the effect of \`--config <PATH>\`: is it a path to a JSON file or an inline JSON string?
  Try both. What if the file does not exist? What if it is invalid JSON?
- Find every accepted key by experiment: add plausible keys (e.g. "code_config":{"font_size":20,
  "tab_size":8, "line_height":1.5, "theme":...}, "window":{"padding":...}, "watermark":{"font_size":...},
  "background":{"color":"#ff0000"} or a plain string) and see whether the tool errors (strict deny_unknown_fields?)
  or accepts and changes the output. Report which keys are RECOGNIZED (change output or are accepted)
  vs REJECTED (error message text) vs IGNORED.
- Determine the exact deserialization error messages for wrong types / missing required keys /
  unknown keys, including line/column info if present.
- Determine which config subtrees may be omitted (defaults) - e.g. does {"snapshot_config":{}} work?
  Does {} work? Does an empty file work?
- Determine what "print_eggs": true does. Try it.
- Determine CLI-vs-config precedence for every overlapping option (theme, margins, border, shadow,
  watermark, title, font families, colors, mac_window_bar, breadcrumbs).
- Determine the "background" schema fully: gradient with start/end/stops (x,y can be the string "max"),
  and whether a solid color form is accepted; what does the CLI --background value accept (hex? name?
  gradient JSON?). Test "#ff0000", "#ff000080", "red", "rgb(1,2,3)", a JSON gradient object.
- Report on \$HOME/.config/codesnap/remote_themes (created empty). What is it for? Try putting a
  .tmTheme or .json theme file in it and see whether the theme name becomes available.`,
  },
  {
    id: 'themes',
    file: '/workspace/notes/06-themes.md',
    task: `Enumerate the available code themes and their colors.
- The error for a bad theme is "Cannot find <name> theme" (exit 1). Use that oracle to test candidate
  names: the default is "candy". Try a large list of plausible names (base16 / bat / sublime / vscode
  style): candy, dracula, monokai, nord, github, github-light, github-dark, one, one-dark, onedark,
  solarized, solarized-dark, solarized-light, gruvbox, gruvbox-dark, gruvbox-light, ayu, ayu-dark,
  ayu-light, ayu-mirage, catppuccin, catppuccin-mocha, catppuccin-latte, tokyonight, tokyo-night,
  vitesse, vitesse-dark, vitesse-light, material, night-owl, rose-pine, everforest, kanagawa,
  base16, base16-ocean, InspiredGitHub, Solarized (Dark), Solarized (Light), Monokai Extended, ...
  Also try case variants and with/without spaces. Report the exact set that WORKS.
- Note: themes may be directory-based; check whether \$HOME/.config/codesnap gains files when a
  theme is used, and look at any files the binary creates for hints (reading files the binary
  creates is allowed).
- For each working theme, render the SAME small snippet and record: window background color,
  and the colors of a handful of code tokens (use \`uniq\` on a cropped region). Build a table.
- Determine whether theme affects the mac window bar, border, line-number color, or only the code.
- Also check whether a theme changes the default \`background\` gradient (probably not) and whether
  there is a light/dark distinction.`,
  },
  {
    id: 'geom-window',
    file: '/workspace/notes/07-geom-window.md',
    task: `Derive the EXACT total-image width and height formula as a function of the window options.
Use --scale-factor 1 everywhere unless testing scaling. Report a table of measurements.
Established: content(window) box for a 1-line snippet with mac bar = 354x72 at scale 1, total
= 518x308 with margin 82/82 (the extra 72 rows below the window are the watermark band, which only
appears when margin_y >= 82 - INVESTIGATE that threshold precisely and explain it: try margin_y
71..90, and vary the watermark content/font to see if the threshold moves).
Determine:
- Minimum window width (354 at scale 1) and what sets it (watermark width? title? mac bar? a constant?).
  Test with --watermark "" / a very long watermark / --title very long / --mac-window-bar false.
- Window padding around the code text: left/right/top/bottom. Find the code text bounding box by
  rendering a single 'X' and locating dark-on-light ink; also use --highlight-range 1:1 with an
  opaque color to reveal the code line band precisely.
- Height per code line (found ~18 at scale 1 - confirm exactly, and for 1..20 lines).
- Mac window bar: exact height contribution (24 at scale 1?), dot positions/radii/colors, and what
  happens with --mac-window-bar false, with --title, and with both.
- Title: does it change window height? Where is it placed? What font size? Long title vs window width.
- Breadcrumbs (--has-breadcrumbs true, needs -f or --file-path): height contribution, position, text.
- Border (--has-border, config border.width/color): does width change geometry?
- Shadow radius: does it change total dimensions? (Test 0, 20, 100.) Does it change margins needed?
- Window corner radius (config window.radius, default 12): visible effect; is it clipped?
- --scale-factor: is it a float? Test 0.5, 1, 1.5, 2, 3, 4, 10, 0. How is rounding done
  (round/floor/ceil) - use a width that is not a multiple of 3 at scale 1 and compare scale 2/3.
- Line-number gutter width as a function of the number of digits (1..5 digits, using
  --start-line-number 1 / 99 / 999 / 9999 with enough lines).`,
  },
  {
    id: 'geom-code',
    file: '/workspace/notes/08-geom-code.md',
    task: `Derive the EXACT code-text metrics model.
Established: the code font is monospace; at --scale-factor 3 the per-character advance is
~21.9727 px (=> ~7.3242 at scale 1, consistent with font size 12.5 and advance 1200/2048 em).
Width for N 'a' chars at scale 3: N=500 -> 11575, N=1000 -> 22561, N=2000 -> 44534.
At scale 1 widths (N -> total): 43->518(min), 44->519?, verify. Measure precisely and fit.
Your job:
- Measure total width at --scale-factor 1 for N = 40..80 and N = 100,200,400,800,1600 with a single
  line of 'a'. Also at --scale-factor 3 for the same N. Fit an exact formula
  (advance per char, constant padding, and the rounding rule: round/ceil/floor, and at which stage
  scaling is applied). Report residuals so a reimplementation can match to the pixel.
- Confirm all ASCII chars have identical advance. Then test: TAB (is it expanded? to how many spaces?),
  CJK (e.g. 'ä½ å¥½' repeated - double width?), emoji, combining accents, zero-width space, RTL text,
  a NUL byte, \\r, \\f, non-UTF8 bytes.
- Determine how trailing/leading blank lines and a trailing newline affect line count and height.
- Determine whether long lines wrap (probably not) and whether there is any max width.
- Determine what happens with 0 lines (empty -c "") and with a file containing only "\\n".
- Determine the vertical metrics: line height at scale 1 (18?), first baseline offset, and where
  ink starts, by rendering "X" on line 1 and line 2 and locating the ink rows precisely
  (use pngtool col scans on a column through the glyph).
- Measure the code area's left inset (x of first glyph ink) with and without line numbers.`,
  },
  {
    id: 'colors-chrome',
    file: '/workspace/notes/09-colors-chrome.md',
    task: `Document the exact rendering of all non-text "chrome": background, shadow, border, corners,
mac window bar dots, and the watermark band.
- Background gradient: config default is start(0,0) end("max",0) stops [0:#6bcba5, 1:#caf4c2].
  Determine the interpolation: sample row y=0 across the full width at scale 1 and 3 and report
  the color at x=0, x=w-1, and several midpoints; determine whether it is linear in sRGB, whether
  there is dithering (adjacent columns differ non-monotonically?), and the exact mapping from x to t.
  Then test: end(0,"max") (vertical), end("max","max") (diagonal), 3+ stops, stops out of order,
  a single stop, position values outside 0..1, and negative coordinates. Also test a solid
  background via CLI --background "#ff0000" and via config, and find how a solid color is specified.
- Shadow: with default radius 20 and color #00000040, characterize the blur profile. Sample a
  column straight down from the window bottom edge and a row out to the left/right, tabulate the
  alpha falloff, and try to identify the kernel (gaussian sigma? box blur passes?). Test radius 0,
  5, 40. Report enough numbers that a reimplementation can match closely.
- Window corner radius 12: sample the corner pixels of the window box and report the anti-aliasing
  ramp along the arc (is it a plain rounded rect? squircle?).
- Border: 1px #ffffff30 - determine precisely which pixel rows/cols it lands on relative to the
  window box, and how it interacts with the corner radius. Test --has-border, --border-color,
  and config border.width 2/3/0.
- Mac window bar: locate the three dots (centers, radius, colors) exactly at scale 1 and 3.
  Determine whether the bar has a separator line or different background.
- Watermark band: find the watermark text ink bbox, its color, approximate font size, and how it is
  centered. Test long/short watermark text and how the band height (72 at scale 1) is derived.`,
  },
  {
    id: 'colors-syntax',
    file: '/workspace/notes/10-colors-syntax.md',
    task: `Determine the syntax-highlighting behavior and color palette for the DEFAULT theme ("candy").
Method: render tiny snippets at --scale-factor 1 (or 2 for legibility) where each line contains
exactly one token kind, then use \`pngtool uniq\` on a crop of that line to read the dominant ink
color (ignore the #282a36 background and antialiased blends - the ink color is the extreme one).
Alternatively render a single line with one token and use \`pngtool row\` through the middle of the glyphs.
- Establish the plain-text/foreground color (e.g. \`-l txt\` or an unknown language).
- For Rust, then Python, then JavaScript/TypeScript, JSON, HTML, CSS, Bash, C, Go, Markdown, YAML, TOML:
  find the color for keywords, control-flow keywords, types, function names, function calls, strings,
  string escapes, numbers, booleans, comments, doc comments, operators, punctuation, macros,
  attributes/annotations, variables, constants, properties/fields, tags, and preprocessor directives.
  Report a per-language table of token -> hex color. Note which tokens share a color.
- Determine whether highlighting is tree-sitter-like (semantic, e.g. distinguishes a function
  definition name from a variable) or regex/oniguruma-like. Design a discriminating test
  (e.g. \`foo(1)\` vs \`foo\`, or a keyword inside a string, or an unterminated string, or nested
  comments, or a raw string) and report.
- Determine the list of supported languages / extensions: try -l with many names and note which
  produce different colorings vs falling back to plain. Also test -f with many extensions
  (.rs .py .js .ts .tsx .jsx .json .html .css .scss .sh .bash .zsh .c .h .cpp .go .java .kt .swift
  .rb .php .lua .vim .sql .yaml .yml .toml .md .txt .Dockerfile .makefile .diff .xml .zig .hs .ml
  .ex .erl .clj .scala .dart .r .jl .nix .proto .graphql .tf .ini .cfg .csv .log) and record which
  get highlighted (compare the rendered images: identical to plain-text rendering => not supported).
  Use \`pngtool uniq\` counts as the comparison signal, or diff two PNGs.`,
  },
  {
    id: 'line-features',
    file: '/workspace/notes/11-line-features.md',
    task: `Document line numbers, diff markers, and highlight ranges precisely.
- \`--has-line-number\` (a flag) and \`--start-line-number N\` (a value): what does each alone do?
  Is the flag needed for start-line-number to take effect? What is printed for N=0, negative, huge?
  Alignment (right/left), gutter width per digit count, color (#495162 default), separator, spacing.
  Determine the exact x-range of the gutter and the code shift at scale 1.
- \`--range\`: semantics of "3:5", "3:", ":5", "3", "-3:", ":-1", "0:2", "5:3", out-of-range values,
  and whether it is 1-based inclusive. Does it interact with line numbers (do displayed numbers
  start at the range start)? Errors for malformed values.
- \`-d/--delete-line\` and \`-a/--add-line\` (multi-valued): what value syntax is accepted
  (single line "3", range "3:5", multiple values "-d 1 -d 3", "-d 1 3")? What is rendered - a full-row
  background tint in --delete-line-color/--add-line-color, and/or a +/- glyph in the gutter?
  Determine the exact rendered geometry: which x range and which y range gets tinted, and the exact
  resulting blended color, so the blend math and alpha can be derived. Test the default colors
  (#ff6b6b30, #2ecc7130) and an opaque color like #ff0000 to make the geometry obvious.
- \`--highlight-range\` "3:5" + \`--highlight-range-color\`, and \`--relative-highlight-range\`:
  determine geometry and blending, and what --relative-highlight-range changes (relative to the
  --range start?).
- \`--raw-highlight-lines\` JSON: exact accepted shapes ([[1,"#f00"],[3,5,"#0f0"]]), error messages
  for malformed input, and how it interacts with --highlight-range.
- Report how out-of-range line numbers behave (ignored? error? clamped?).`,
  },
  {
    id: 'text-chrome',
    file: '/workspace/notes/12-text-chrome.md',
    task: `Document the non-code text elements: title, breadcrumbs, watermark - geometry, fonts, colors.
- \`--title\`: where is it drawn (centered in the mac bar? left?), what color (config #ffffff),
  what font (config "Pacifico"), what size? Determine the ink bbox at scale 1 and 3 for a known
  string. Does a long title widen the window? Does the title change window height when
  --mac-window-bar false? What about an empty title?
- \`--has-breadcrumbs true\` (requires a file path from -f or --file-path): exact rendered text
  (does it include the full path as given, or an absolute path? how are separators rendered -
  the config default separator is "/" and --breadcrumbs-separator can change it). Is there a
  leading/trailing separator? Test a deep relative path, an absolute path, a bare filename,
  a path with unicode. Determine the y band it occupies, its effect on window height, font size,
  and color (#80848b default).
- \`--watermark\`: exact centering, color, font, size. How is the band height determined?
  Test a very long watermark (does it widen the image?), an empty one, a multi-line one, unicode.
- Determine the font each element uses by comparing shapes: the title/watermark use "Pacifico"
  (a cursive script font) and the code uses "CaskaydiaCove Nerd Font". Verify that changing
  --title-font-family / --watermark-font-family / --breadcrumbs-font-family / --code-font-family
  to a nonexistent name changes NOTHING (suspected: font families are ignored because no font
  files are installed and fonts are embedded) - or find which names DO change rendering.
  Try "Pacifico", "CaskaydiaCove Nerd Font", "DejaVu Sans Mono", "DejaVu Sans", "serif", junk.
  Report definitively, with pngtool diff evidence.`,
  },
  {
    id: 'ascii-mode',
    file: '/workspace/notes/13-ascii-mode.md',
    task: `Investigate \`--type ascii\` as far as possible.
It warns "ASCII snapshot only supports copying to clipboard" and then exits 0 (CHECK the exit code
and whether a file is written). With \`-o clipboard\` it fails with an X11 clipboard error (exit 1).
- Determine the exact behavior/exit codes for: --type ascii -o file.png, -o file.txt, -o file.svg,
  -o file.html, -o clipboard, and with --silent.
- Find out whether any environment variable makes the clipboard path succeed or print the ASCII to
  stdout. Try DISPLAY unset/empty, WAYLAND_DISPLAY=x, XDG_SESSION_TYPE=wayland, TERM variations,
  and check the exact error message for each (they may differ: X11 vs wayland vs "no clipboard").
  Record every distinct message verbatim with its exit code.
- Determine the argument-validation order: does --type ascii with a bad theme report the theme error
  or the ascii warning first? Does it validate the output extension first? Build a table of
  which error wins for combinations (bad theme + ascii, missing file + ascii, bad range + ascii).
- Also test \`-o clipboard\` with --type image (default) and record that error text and exit code.
- Do NOT attempt to install or build an X11 server. Just characterize the messages.`,
  },
  {
    id: 'languages',
    file: '/workspace/notes/14-languages.md',
    task: `Determine the exact set of recognized languages and file extensions, and the detection rules.
Method: for a fixed code snippet that contains constructs highlighted differently in different
languages, render with -l <name> and compare the PNGs. Two names that yield byte-identical PNGs
are equivalent; a name yielding the same PNG as a known-unsupported name (e.g. -l zzzznotalang)
is unsupported. Note: an unknown -l value does NOT error (it silently falls back).
- Build the equivalence classes over a large candidate list of language names AND aliases
  (rust, rs, python, py, python3, javascript, js, jsx, typescript, ts, tsx, json, json5, jsonc,
  html, xml, svg, css, scss, sass, less, bash, sh, shell, zsh, fish, c, cpp, c++, cc, h, hpp,
  csharp, cs, go, golang, java, kotlin, kt, swift, objc, ruby, rb, php, perl, lua, vim, viml,
  sql, yaml, yml, toml, ini, markdown, md, text, txt, plaintext, diff, patch, dockerfile,
  makefile, cmake, nix, zig, haskell, hs, ocaml, ml, elixir, ex, erlang, erl, clojure, clj,
  scala, dart, r, julia, jl, proto, graphql, terraform, hcl, tsx, vue, svelte, astro, elm,
  fsharp, groovy, powershell, ps1, asm, latex, tex, bibtex, org, rst, csv, tsv, awk, sed,
  regex, jinja, twig, handlebars, ejs, pug, jade, stylus, coffeescript, solidity, prisma,
  graphviz, dot, gitignore, gitconfig, editorconfig, properties, log, nginx, apache, systemd).
  Report which are recognized (distinct highlighting) and which fall back to plain.
- Then determine extension-based detection with -f: create files with each plausible extension
  containing the same content, render, and compare against the -l equivalence classes to map
  extension -> language. Also test special filenames without extensions: Dockerfile, Makefile,
  CMakeLists.txt, .gitignore, .bashrc, LICENSE, README (no ext).
- Determine precedence: -l vs -f extension vs --file-path.
- Determine whether the language affects anything other than colors (e.g. tab width).`,
  },
];

phase('Probe')

const results = await parallel(AREAS.map((a) => () =>
  agent(
    PREAMBLE.replace(/\$AGENT/g, a.id) +
    `\n## YOUR AREA: ${a.id}\nWrite your report to: ${a.file}\n\n${a.task}\n`,
    { label: `probe:${a.id}`, phase: 'Probe' }
  ).then((r) => ({ id: a.id, file: a.file, summary: r }))
));

return results.filter(Boolean);
