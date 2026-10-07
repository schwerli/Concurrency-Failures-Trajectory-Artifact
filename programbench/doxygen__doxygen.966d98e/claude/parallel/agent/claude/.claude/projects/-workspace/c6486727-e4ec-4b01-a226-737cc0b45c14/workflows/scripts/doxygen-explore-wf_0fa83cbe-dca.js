export const meta = {
  name: 'doxygen-explore',
  description: 'Fan out probes of the doxygen 1.17.0 binary to map its observable behavior into notes files',
  phases: [
    { title: 'Probe', detail: 'independent agents probe distinct behavior areas' },
    { title: 'Critic', detail: 'completeness critic over the notes' },
  ],
}

const AREAS = [
  {
    key: 'cli',
    title: 'CLI argument handling and exit codes',
    prompt: `Probe the CLI argument handling of /workspace/executable (doxygen 1.17.0). Work ONLY in /tmp/probe-cli (mkdir it). You may run the binary with any arguments. You MUST NOT disassemble/decompile/strace it.

Map exhaustively, capturing EXACT stdout/stderr text and exit codes:
- no arguments at all (in a dir with no Doxyfile, and in a dir WITH a Doxyfile)
- -v, -V, -h, -?, --help, --version, unknown flags like -Z, --foo
- -g with/without filename, -g - (stdout), -s -g, -g into unwritable path, -g when file already exists
- -u with/without filename, -u - , -u on nonexistent file, -s -u
- -l, -l -, -l with path in nonexistent dir
- -w with missing/extra args: 'doxygen -w', 'doxygen -w rtf', 'doxygen -w html a', 'doxygen -w html a b', 'doxygen -w html a b c', 'doxygen -w latex a b c', 'doxygen -w bogus a'
- -e, -e rtf, -e bogus x
- -f, -f emoji, -f bogus x, -f emoji -
- -x, -x_noenv on nonexistent file / on - / with no arg
- -q, -b, -m, -c, -d with valid/invalid level names (exact error text for invalid -d level)
- combinations and ordering: does '-g -s' work same as '-s -g'? does '-v' after other args win?
- what happens with extra trailing positional args
- exit codes for every case

Write your complete findings, with exact quoted text blocks, to /tmp/notes/cli.md. Be extremely precise about whitespace, blank lines, and whether output goes to stdout or stderr (test with 2>/dev/null and 1>/dev/null separately).

Return a concise (<40 line) summary of the most important/surprising rules. The notes file is the real deliverable.`,
  },
  {
    key: 'configparse',
    title: 'Doxyfile parsing semantics',
    prompt: `Probe how /workspace/executable (doxygen 1.17.0) PARSES a Doxyfile. Work ONLY in /tmp/probe-cfgparse (mkdir it). Do not disassemble.

Use 'doxygen -x <file>' (which echoes non-default values, and also validates) and 'doxygen -u' to observe how values were parsed.

Investigate exhaustively:
- whitespace around '=' , tabs, leading spaces on tag names
- '+=' append semantics for list options and for string options; '+=' on an option never previously set
- line continuation with trailing backslash (with trailing spaces after backslash? escaped backslash?)
- quoting: "a b", nested quotes, \\" escapes, quote in middle of token, unterminated quote (exact warning)
- comments: '#' at start, '#' mid-line, '##' , '#' inside quotes
- environment variable expansion: $(VAR), curly-brace form, bare $VAR, undefined var, nested; and how -x_noenv differs from -x
- CMake-style @VAR@ replacement variables: exact behavior and how -x_noenv differs
- @INCLUDE and @INCLUDE_PATH: relative resolution, missing file warning text, nesting, does it affect -x output
- duplicate assignment of same tag (last wins? warning?)
- a tag with no '=' at all (exact warning)
- empty value clears a list?
- case sensitivity of tag names and of boolean values (yes/Yes/1/true/on)
- reading config from stdin via '-'
- what exact warning appears for unsupported vs obsolete tags, and gather the FULL LIST of obsolete tag names doxygen recognizes (try many old doxygen tag names: DETAILS_AT_TOP, CGI_NAME, USE_WINDOWS_ENCODING, SHOW_DIRECTORIES, HTML_ALIGN_MEMBERS, PERL_PATH, MSCGEN_PATH, TCL_SUBST, XMLGEN, CLASS_DIAGRAMS, DOT_FONTNAME, DOT_FONTSIZE, DOT_TRANSPARENT, LATEX_SOURCE_CODE, LATEX_HIDE_INDICES, RTF_SOURCE_CODE, DOCBOOK_PROGRAMLISTING, USE_MDFILE_AS_MAINPAGE ... and any others you can think of from doxygen history) and note which say 'This tag has been removed.' vs which map to a replacement tag.

Write complete findings with exact quoted text to /tmp/notes/configparse.md. Return a <40 line summary.`,
  },
  {
    key: 'configtypes',
    title: 'Config option types, ranges, enum values, defaults',
    prompt: `Determine the TYPE of every configuration option of /workspace/executable (doxygen 1.17.0). Work ONLY in /tmp/probe-cfgtypes (mkdir it). Do not disassemble.

Method: 'doxygen -g full' gives the template with all option names. For each option, write a minimal Doxyfile containing 'OPT = ___BOGUS___' and run 'doxygen -x Doxyfile' — validation warnings reveal the type:
  "argument '...' for option X is not a valid boolean value" -> bool
  "argument '...' for option X is not a valid enum value" -> enum
  "argument '...' for option X is not a valid number in the range [a..b]" -> int with range
  no warning -> string-ish (string/list/path/file/dir/image)
Write a shell/python script to do this for ALL options in a batched way (you can put many options in one Doxyfile at once to save time, but beware warning ordering; verify with a couple of single-option runs).

Then:
- For every enum option, determine the exact set of allowed values. The doc comment in the template lists them ("Possible values are: ..."), but VERIFY a sample by trying each value and confirming no warning, and confirm case-insensitivity.
- For every int option, record the exact [min..max] and default from the warning text.
- Determine the exact ORDER in which validation warnings are emitted when many options are invalid at once (is it template order, or grouped by type?). Test with a config that has an invalid bool early and invalid enum late, etc.
- Distinguish list-valued options from single-string options: set 'OPT = aa bb cc' and look at 'doxygen -x' output — lists are re-emitted one-per-line with ' \\' continuations, strings are re-emitted as a single quoted value. Do this for every non-bool/non-int/non-enum option and classify.
- Note any option whose default in the -g template is NOT what a bare 'doxygen -x' considers default (i.e. options that would show up in -x with an empty config) — run 'doxygen -x' on a completely EMPTY Doxyfile and report exactly what it prints.

Deliverable: write /tmp/notes/configtypes.md containing a machine-readable table, one line per option:
  NAME|KIND|EXTRA
where KIND is one of BOOL,INT,ENUM,STRING,LIST and EXTRA is 'min..max default' for INT, comma-separated allowed values for ENUM, empty otherwise. Include ALL options. Also include the validation-order findings and the empty-config -x output.

Return a <40 line summary including counts per kind and the validation order rule.`,
  },
  {
    key: 'commentblock',
    title: 'Comment block to HTML via -c',
    prompt: `Explore the '-c <file>' developer flag of /workspace/executable (doxygen 1.17.0): "process input file as a comment block and produce HTML output". Work ONLY in /tmp/probe-c (mkdir it). Do not disassemble.

Determine exactly:
- what output file(s) it produces and where, and the exact surrounding HTML boilerplate
- exit code, stdout/stderr messages
- Then use it as a microscope on doxygen's comment parser. For a wide variety of inputs, record input -> exact HTML output:
  * plain text, paragraphs, blank lines
  * \\brief, \\details, \\param, \\tparam, \\return, \\retval, \\note, \\warning, \\see, \\since, \\author, \\date, \\bug, \\todo, \\deprecated, \\pre, \\post, \\invariant, \\attention, \\remark, \\par, \\arg, \\li
  * \\code / \\endcode, \\verbatim, \\code{.py}, inline \`code\`, \\c word, \\b word, \\e word, \\p word
  * lists: '-' bullets, '-#' numbered, nested; markdown lists; markdown headings; markdown tables; markdown emphasis *x* **x** _x_ __x__; markdown links [t](u); autolinks
  * \\ref, \\link/\\endlink, \\anchor, \\section/\\subsection, \\page
  * \\f$ \\f[ formulas, \\image, \\dot, \\msc, \\emoji, HTML entities like \\&copy; and &copy;, <b>raw html</b>
  * \\a, \\n, escaped chars \\\\ \\@ \\# \\% \\" \\< \\>
  * tables via \\table? html <table>
  * \\subpage, \\cite, \\xrefitem
- exact warning text for unknown commands, for \\param on nonexistent param, etc.

Write exhaustive input->output pairs to /tmp/notes/commentblock.md (use fenced blocks). Focus on getting the EXACT HTML doxygen emits for each construct, including <p>, <br/>, class names, dl/dt/dd structure.

Return a <40 line summary of the key HTML shapes (e.g. how \\param renders, how \\note renders).`,
  },
  {
    key: 'htmlout',
    title: 'HTML output structure',
    prompt: `Map the HTML output of /workspace/executable (doxygen 1.17.0). Work ONLY in /tmp/probe-html (mkdir it). Do not disassemble.

Create several small C/C++ inputs and run doxygen with GENERATE_HTML=YES, GENERATE_LATEX=NO. Capture and document:
- the complete list of generated files and the file-naming scheme: how are names derived (classFoo.html, structBar.html, a_8h.html for a.h, namespaceX.html, dir_<md5>.html, group__x.html, md_page.html, etc.). Determine EXACTLY the escaping rule for names (e.g. '_8' for '.', '__' for '_', case-mangling with '_' prefix for uppercase letters). Test with files/classes named: a.h, A.h, my_file.h, My_File.h, foo-bar.h, a+b.h, dir/sub/x.h, class names with :: and templates.
- the md5-based dir_ names: figure out what string is hashed (test by computing md5 of candidate strings with md5sum).
- the exact HTML of index.html, annotated.html, classes.html, files.html, functions.html, globals.html and a class page for a simple documented class. Save copies of the raw files under /tmp/notes/html-samples/ (keep them, they are the deliverable) and describe the structure.
- the static resource files (doxygen.css, doxygen.svg, dynsections.js, clipboard.js, cookie.js, menu.js, navtree.js, navtree.css, tabs.css, search/*). Copy them verbatim to /tmp/notes/html-resources/. Note which config options add/remove which resource files (DISABLE_INDEX, GENERATE_TREEVIEW, SEARCHENGINE, HTML_DYNAMIC_SECTIONS, COPY_CLIPBOARD, HTML_COLORSTYLE, FULL_SIDEBAR).
- doxygen_crawl.html content rule
- how HTML_COLORSTYLE=LIGHT/DARK/AUTO_LIGHT changes doxygen.css (is it generated/tinted? try HTML_COLORSTYLE_HUE/SAT/GAMMA and diff the css)
- the *.js sidecar files per page (a_8h.js, classFoo.js, annotated_dup.js, files_dup.js, navtreeindex0.js, menudata.js, search/*.js) and their exact format

Write findings to /tmp/notes/htmlout.md. Return a <50 line summary emphasising the file-naming/escaping algorithm and the resource-file rules.`,
  },
  {
    key: 'latexout',
    title: 'LaTeX / man / RTF / DocBook / XML output',
    prompt: `Map the non-HTML output formats of /workspace/executable (doxygen 1.17.0). Work ONLY in /tmp/probe-other (mkdir it). Do not disassemble.

For a small documented C++ input (one class with brief+detailed docs, one function with \\param/\\return, one file with \\file), generate each of: GENERATE_LATEX, GENERATE_MAN, GENERATE_RTF, GENERATE_DOCBOOK, GENERATE_XML, GENERATE_AUTOGEN_DEF, GENERATE_PERLMOD, GENERATE_SQLITE3, GENERATE_TAGFILE (all others NO).

For each: list generated files, and copy the raw generated files into /tmp/notes/other-samples/<format>/ (deliverable). Describe:
- LaTeX: refman.tex structure, per-class .tex files and naming, Makefile and make.bat content, the extra .sty/.md5/.pdf files doxygen copies in (doxygen.sty, tabu.sty, longtable_doxygen.sty, etc.) — copy them verbatim.
- man: file naming (man/man3/Foo.3), exact roff content
- XML: index.xml, index.xsd, compound.xsd, Doxyfile.xml?, per-compound xml naming; copy the xsd files verbatim (they are static)
- DocBook: file names and structure
- Tag file: exact XML structure
- RTF: refman.rtf structure
- perlmod / sqlite3 / autogen: what appears

Write findings to /tmp/notes/otherout.md. Return a <50 line summary.`,
  },
  {
    key: 'engine',
    title: 'Parser/engine semantics',
    prompt: `Probe the C/C++ parsing + doc-model semantics of /workspace/executable (doxygen 1.17.0). Work ONLY in /tmp/probe-engine (mkdir it). Do not disassemble.

Using small inputs and XML output (GENERATE_XML=YES, GENERATE_HTML=NO — XML is the easiest to inspect), determine how doxygen models:
- classes/structs/unions, access sections, nested classes, inheritance (public/protected/private, virtual), templates
- functions: return types, arg lists, const/static/virtual/inline/noexcept/explicit, default args, function pointers
- variables, enums (+ enum values, enum class), typedefs, using aliases, #define macros (with args)
- namespaces (incl. anonymous, nested, inline), file/dir hierarchy
- \\file, \\class, \\fn, \\var, \\def, \\enum, \\namespace, \\struct, \\brief, \\ingroup, \\defgroup, \\addtogroup, \\page, \\mainpage, \\section, \\subsection, \\anchor, \\ref
- brief vs detailed extraction rules: JAVADOC_AUTOBRIEF, QT_AUTOBRIEF, MULTILINE_CPP_IS_BRIEF, '///<' trailing comments, '//!<' , '/**< */'
- which comment styles are recognized (/** */, /*! */, ///, //!, /******/ )
- EXTRACT_ALL / EXTRACT_PRIVATE / EXTRACT_STATIC / HIDE_UNDOC_MEMBERS effects
- markdown .md file handling: does it become a page? what is the page name/id? USE_MDFILE_AS_MAINPAGE
- \\defgroup and group pages
- anchors/ids: how are member 'id' attributes and HTML anchors computed (e.g. 'classFoo_1a1234abcd') — figure out the hash rule if possible (try md5 of the member's qualified signature; report your best hypothesis with evidence)
- the exact set of "warning:" messages doxygen emits for undocumented params, mismatched params, unknown commands, etc.

Write findings to /tmp/notes/engine.md, and keep sample XML under /tmp/notes/engine-samples/. Return a <50 line summary highlighting the member-anchor/id computation rule and the most important modelling facts.`,
  },
  {
    key: 'messages',
    title: 'Progress messages and warning machinery',
    prompt: `Map the exact console output of a documentation run of /workspace/executable (doxygen 1.17.0). Work ONLY in /tmp/probe-msg (mkdir it). Do not disassemble.

- Capture the FULL ordered list of progress lines printed for a run (default QUIET=NO) with (a) an empty input set, (b) one .h file, (c) a .h plus a .md plus a .py, with HTML only, and with HTML+LaTeX+XML+MAN+RTF+DOCBOOK all on. Write the exact ordered line lists to /tmp/notes/messages.md.
- Determine which lines go to stdout vs stderr.
- Determine what QUIET=YES / -q suppresses, and what WARNINGS / WARN_IF_UNDOCUMENTED / WARN_IF_DOC_ERROR / WARN_NO_PARAMDOC / WARN_AS_ERROR do (exact texts, exit codes; test WARN_AS_ERROR=YES/NO/FAIL_ON_WARNINGS/FAIL_ON_WARNINGS_PRINT).
- WARN_FORMAT and WARN_LINE_FORMAT substitution ($file,$line,$text,$version).
- WARN_LOGFILE behavior.
- The exact text of the final summary lines (e.g. 'lookup cache used ...', 'finished...', 'Generating ...' lines), and any 'Note: ...' lines.
- exit code of a successful run; of a run with warnings.
- Test what happens with a nonexistent INPUT path, an INPUT that is a file vs dir, EXCLUDE patterns, RECURSIVE, FILE_PATTERNS defaults (which extensions are picked up by default? test many extensions), EXTENSION_MAPPING.

Return a <50 line summary; notes file is the deliverable.`,
  },
]

phase('Probe')
const results = await parallel(AREAS.map(a => () =>
  agent(a.prompt, { label: `probe:${a.key}`, phase: 'Probe' })
))

phase('Critic')
const summary = AREAS.map((a, i) => `## ${a.key} (${a.title})\n${results[i] || '(FAILED)'}`).join('\n\n')
const critic = await agent(`Below are summaries from 8 parallel probes of the doxygen 1.17.0 binary at /workspace/executable. Full notes are in /tmp/notes/*.md.

Your job: identify what is MISSING or UNRESOLVED that a reimplementer would need. Read the notes files (they are the real data). Then run additional probes yourself in /tmp/probe-critic to close the 5 most important gaps, and append your findings to the relevant notes files.

Prioritise: (1) exact algorithms (name mangling, md5 anchors), (2) exact static resource inventory, (3) config option kinds/defaults completeness, (4) exact warning/progress text, (5) anything where a summary says "unclear" or "probably".

${summary}

Return a <60 line report: what gaps you closed, what remains genuinely unresolved.`, { label: 'critic', phase: 'Critic' })

return { summary, critic }
