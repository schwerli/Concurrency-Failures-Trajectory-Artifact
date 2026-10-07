export const meta = {
  name: 'sevenzip-behavior-survey',
  description: 'Exhaustively probe ./executable (7za 26.00) behavior and write detailed notes for reimplementation',
  phases: [
    { title: 'Probe', detail: 'parallel agents probe distinct CLI/format surfaces' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed surfaces' },
  ],
}

const RULES = `
CONTEXT: /workspace/executable is a compiled binary of 7-Zip 26.00 standalone console ("7za").
We are reimplementing it from scratch by BEHAVIORAL OBSERVATION ONLY.

HARD RULES (violating these fails the whole task):
- You MUST NOT decompile, disassemble, or inspect the binary's machine code. No objdump/nm/readelf/gdb/ghidra/strings on /workspace/executable.
- You MUST NOT run strace/ltrace on it.
- You MUST NOT search the web, package registries, or any external source for 7-Zip source code or implementation details.
- You MUST NOT install 7-zip/p7zip from a package manager.
- ONLY interact with it via its normal CLI: run it with flags/args/stdin and observe stdout/stderr/exit code and produced files.
- You MAY read /workspace/DOC/*.txt and /workspace/README.md.
- You MAY use general tools (od, cmp, python3, xz, gzip, bzip2, tar) on files YOU create.

WORKING DIR: create your own scratch dir under /tmp/7z-probe/<yourtopic>/ and work there. Never write into /workspace.
Invoke as: /workspace/executable <args>
NOTE: output goes to stdout by default; capture with 2>&1 and also separately to see the stdout/stderr split.
NOTE: there is no 'xxd'; use 'od -A d -t x1z' or python3.

DELIVERABLE: write a DETAILED, PRECISE notes file at /tmp/7z-notes/<TOPIC>.md containing:
 - exact literal output text (in fenced blocks, preserving blank lines and spacing; mark trailing spaces explicitly)
 - column widths / alignment rules you inferred, with the experiments that prove them
 - exit codes
 - which stream (stdout=1 vs stderr=2) each piece went to
 - edge cases and error messages verbatim
Be exhaustive and literal: someone must be able to reproduce byte-identical output from your notes WITHOUT access to the binary.
Then return a SHORT summary (under 40 lines) of key findings + the notes file path.
`;

const TOPICS = [
  {
    key: 'cli-banner-usage-exitcodes',
    prompt: `TOPIC: banner, usage/help text, argument parsing errors, exit codes.

Probe and document exactly:
1. The version banner: exact bytes, is there a leading newline? trailing? Which stream? Compare 'executable' with no args vs 'executable l file' etc. Use od to check exact whitespace/newlines at start and end.
2. Full usage text when invoked with: no args; with only switches; 'executable --help'; 'executable -h'; 'executable ?'; unknown command 'executable zz'; empty string command.
3. Exit codes for: success, warning (e.g. a file could not be opened), fatal error, bad command line, user break. Try to enumerate which numbers appear (0,1,2,7,8,255).
4. Error message formats verbatim for: unsupported command; unsupported switch (e.g. -qqq); missing archive name; too short switch; incorrect wildcard; duplicate switch; '-t' with unknown type; cannot find archive.
5. Where does the "Command Line Error:" / "System ERROR:" / "ERROR:" prefix appear, and what stream, and exit code for each.
6. Does the banner appear before or after error text? Test with stdout and stderr redirected separately.
7. Behavior of '--' terminator, and of a bare '-' argument.
8. What happens with 'executable' and an argument that is a switch with '=' or unusual forms.
Document the COMPLETE usage/help text verbatim.`,
  },
  {
    key: 'info-command',
    prompt: `TOPIC: the 'i' (info) command and the format/codec/hasher flag columns.

1. Capture 'executable i' output byte-exactly (use od / cat -A) including all trailing spaces and blank lines.
2. Determine the exact column layout: width of the flags field, the name field, the extensions field, signature field. Prove with experiments (compare lines).
3. Try 'i' with switches: -slt, -ba, -bso0, -bsp0, and with a type filter e.g. 'i -t7z', 'i -tzip'. Document any differences.
4. Document the flags string semantics as far as observable (each character position and which formats have it). List for every format the exact 23-char (verify width!) flag string.
5. Document Codecs section columns exactly (the numeric IDs are printed how? width? uppercase hex? leading spaces?) and Hashers section columns.
6. Check 'executable i' exit code and stream.
Provide a machine-usable table of: format name, extensions string, signature-display string, flags string; codec id hex + flags + name; hasher digest-size + id + name.`,
  },
  {
    key: 'hash-command',
    prompt: `TOPIC: the 'h' (hash) command.

1. Default output layout for: one file, several files, a directory, empty file, file with 0 bytes, nested dirs with -r.
2. Exact column widths and separator lines. Prove alignment with long file names and big files.
3. All accepted -scrc values: try CRC32 CRC64 SHA1 SHA256 SHA512 SHA384 SHA224 SHA3-256 MD5 BLAKE2S BLAKE2B BLAKE2SP XXH64 CKSUM ASC '*' and lowercase variants, and combinations like -scrcsha1 -scrccrc32. Which work, which give errors (verbatim error + exit code)?
4. Order of hash columns when '*' is used, and when multiple -scrc switches are given.
5. The trailing summary block: 'Size:' line, the 'X for data:' lines, exact spacing/padding of the hash name field. Also is there a 'for data and names:' variant? Try 'h' on multiple files and directories.
6. 'h' with -si (stdin) — output format. Also with '-si{name}'.
7. 'h' on a nonexistent file: message + exit code.
8. Hash values: verify against python hashlib/zlib so we know the algorithms/endianness/case (upper vs lower hex) for each of CRC32, CRC64 (which polynomial/init? verify against known values), SHA1, SHA256, XXH64.
9. Does 'h' support -slt? -ba? What about 'executable h' with no args (hash of current dir?).
10. Check the alternative form: 'executable h -thash ...' or using the Hash format via 'a out.sha256 file'. Try 'a x.sha256 file', 'a x.asc file', 'a x.crc32 file' - document.`,
  },
  {
    key: 'archive-7z-create',
    prompt: `TOPIC: creating 7z archives with 'a' — console output and archive structure.

1. Exact 'a' command console output for: new archive, adding to existing, nothing to do, single file, many files, directories, empty files, empty dirs. Include the "Scanning the drive:" block, "Creating archive:", "Add new data to archive:", "Files read from disk:", "Archive size:", "Everything is Ok" lines and ALL blank lines. Note byte-exact spacing.
2. Human-readable size suffix logic: capture the "N bytes (M KiB)" formatting for many sizes (0,1,999,1024,1025,1048575,1048576,1073741824,...) and derive the exact rule (rounding, which unit chosen, when parenthetical is omitted).
3. Effect of -mx0 -mx1 -mx3 -mx5 -mx7 -mx9 on the reported 'Method =' in 'l', and archive size, for a fixed input. Also -m0=Copy, -m0=LZMA, -m0=LZMA2, -m0=PPMd, -m0=BZip2, -m0=Deflate (which are accepted for 7z?).
4. -mhc=off/on, -mhe=on (header encryption, needs -p), -ms=off/on (solid), -ms=1m, -mmt=1/2, -md=64k/1m, -mfb, -mlc, -mpb, -mo? Document which -m params are accepted and error text for bad ones.
5. What 'l' reports as Method= for each of these (exact strings like 'LZMA2:12', 'LZMA:16 BCJ', 'Copy').
6. Determinism: run the same 'a' twice on same input -> are the archive bytes identical? (mtimes will differ; use files with fixed mtime via touch -d). Compare with cmp. This tells us whether byte-exact output is achievable.
7. Does it store timestamps (mtime/atime/ctime), attributes, symlinks by default? Use 'l -slt' to see.
8. -t7z explicit; creating with extension .7z vs other names; what determines format.
Write down the full observed archive byte layout ONLY as far as visible from 'l -slt' output (do NOT decompile). You MAY hexdump archives YOU created with the binary — that is allowed (it's data, not code).`,
  },
  {
    key: 'archive-7z-bytes',
    prompt: `TOPIC: reverse-engineer the on-disk 7z container format by hexdumping archives the binary creates.

You may freely hexdump/analyze .7z files that YOU create with /workspace/executable (they are data files, not the program). Goal: understand the 7z header structure well enough to write an encoder/decoder.

1. Create minimal archives: (a) one 0-byte file, (b) one small file with -m0=Copy, (c) two files with -m0=Copy -ms=off, (d) an empty directory, (e) with -mhc=off (uncompressed header) so the header is readable.
2. Using -mhc=off, dump the header bytes and map out the structure: signature (6 bytes + 2 version + 4 CRC), NextHeaderOffset/Size/CRC (8/8/4 LE), then the header itself. Decode the property IDs you observe (kHeader, kMainStreamsInfo, kPackInfo, kUnPackInfo, kSubStreamsInfo, kFilesInfo, kName, kMTime, kAttributes, kEmptyStream, kEmptyFile, kEnd...) and the NUMBER encoding (the first-byte mask variable-length integer). Verify your NUMBER decoding on several archives with different sizes.
3. Determine exact BitVector encoding (MSB-first bytes) for kEmptyStream/kCRC defined bits.
4. Determine how names are stored (UTF-16LE, null-terminated, kName with external byte).
5. Determine how attributes are stored for Linux (0x8000 flag + unix mode <<16?). Verify by creating files with different chmod and reading 'l -slt' Attributes field.
6. Determine timestamp encoding (Windows FILETIME 100ns since 1601, LE 64-bit) by creating a file with a known mtime (touch -d '2001-02-03 04:05:06 UTC') and locating the bytes.
7. Determine coder-chain encoding in kUnPackInfo (folder: numCoders, flags byte, id size, id bytes, props). Document what LZMA2 props byte, LZMA 5-byte props, Delta props, BCJ props look like.
8. Report the byte layout of a minimal Copy-coded 2-file archive completely, annotated offset by offset.
Write this all into the notes file with annotated hexdumps.`,
  },
  {
    key: 'list-command',
    prompt: `TOPIC: the 'l' (list) command output for every format.

1. Default 'l' layout: exact header lines, dashed separator widths, the date/time/attr/size/compressed/name columns, and the totals line. Prove column widths using long names, big sizes, directories, empty files.
2. Attributes column rendering: 5 chars like '....A' / 'D....' — enumerate what each position means by creating files/dirs with different chmod, read-only, etc. Also the 6th+ chars for unix mode if any.
3. The archive-properties block printed before the table (Path=, Type=, Physical Size=, Headers Size=, Method=, Solid=, Blocks=, and others). Which appear for which formats?
4. 'l -slt' full technical output for: 7z, zip, tar, gzip, bzip2, xz, and a plain non-archive file. Document EVERY property line and its order, verbatim, including the '----------' separator and 'Path = ' entries.
5. 'l -ba' (no header/footer), 'l -slt -ba'. Also '-bso0'/'-bse0'/'-bsp0' effects, '-bb3' verbose.
6. Listing with wildcards/file filters: 'l archive.7z *.txt'.
7. Listing multiple archives at once, and a nonexistent archive, and a directory, and an empty file, and a truncated/corrupt archive: verbatim messages + exit codes.
8. 'l' on stdin via -si.
9. Empty archive (created with 'a' and no files? or from a file list that matches nothing) - message.
Also document the 'Warnings:'/'Errors:' summary lines at the end when problems occur.`,
  },
  {
    key: 'extract-command',
    prompt: `TOPIC: 'x' and 'e' (extract) commands.

1. Exact console output of a successful 'x' and 'e' (all lines/blank lines): "Extracting archive:", per-file lines?, "Everything is Ok", "Folders: N", "Files: N", "Size: N", "Compressed: N". Determine when each summary line appears (e.g. only when folders exist).
2. Difference between x and e for nested paths. -spe behavior.
3. -o output dir (with and without trailing slash, nonexistent dir, -o with no value).
4. Overwrite behavior: default interactive prompt text verbatim (feed answers via stdin: y,n,a,s,q,u,t and invalid input). -aoa -aos -aot -aou semantics with actual resulting filenames (e.g. "file_1.txt"? what naming?).
5. -y switch effect.
6. Extracting a subset by name/wildcard, and when a named file is missing: verbatim error + exit code (does it print "WARNING: No files, folders..." or similar?).
7. Extract with -so (to stdout): what goes to stdout vs stderr, ordering.
8. Extract preserving timestamps/attributes: verify mtime and mode are restored (compare stat before/after).
9. Extract a password-protected archive without -p (prompt text) and with wrong password (verbatim error + exit code).
10. Extract corrupted archive: verbatim errors, "ERRORS:" / "Sub items Errors:" lines, exit code.
11. 'x' with no archive, with nonexistent archive.
12. Test 'e' collision when two files in different dirs share a basename.`,
  },
  {
    key: 'test-delete-update-rename',
    prompt: `TOPIC: 't' (test), 'd' (delete), 'u' (update), 'rn' (rename) commands.

1. 't' output verbatim for a good archive (all lines), for each format. Include "Testing archive:", the summary block ("Folders:", "Files:", "Size:", "Compressed:"), "Everything is Ok".
2. 't' on corrupted data (flip bytes in the compressed stream, in the header, truncate) -> verbatim errors, exit codes, "ERRORS:" counts, "Sub items Errors:".
3. 't' with -scrc variations? 't' on non-archive.
4. 'd' output verbatim; deleting one of several files; deleting all files; deleting a nonexistent name; from solid 7z (does it recompress?); note "Updating archive:" header lines.
5. 'u' output verbatim; the -u{...} switch syntax: try -u-, -up0q3r2x2y2z1w2, and the documented p#q#r#x#y#z# state chars; document accepted characters and error text for invalid ones. Show behavior for: file newer on disk, older, same, missing on disk, new file.
6. 'rn' output verbatim; 'rn arch.7z old new'; renaming with wildcards; renaming nonexistent; odd number of args error.
7. Exit codes for each.
8. 'a' on an existing archive that is not the right type; 'a' with -so; multivolume -v (create and list), verbatim output and produced file names.`,
  },
  {
    key: 'formats-tar-gzip-bzip2-xz',
    prompt: `TOPIC: tar, gzip, bzip2, xz, lzma, lzma86, split, zstd formats.

1. For each of tar/gzip/bzip2/xz: create with 'a' (e.g. a out.tar files, a out.gz file, a out.bz2 file, a out.xz file). Document console output, whether multiple files are allowed (error text if not), and 'l' + 'l -slt' output.
2. Compare the bytes produced against system tools: does 'a out.gz f' match 'gzip -n -9 f'? Check gzip header bytes (mtime field? OS byte? name field?) with od. Same for bzip2 (block size?) and xz (filters/check type, use 'xz --list' on the produced file? xz binary IS available and is a different program - allowed to use on files you create). Determine default settings the binary uses (compression level, dict size, check type).
3. Reading: create .gz/.bz2/.xz with the SYSTEM tools and read them with the binary ('l -slt', 't', 'x'). Document property output including 'Name', 'Comment', 'Host OS', 'Modified', 'CRC', 'Method' fields.
4. tar: document 'l -slt' fields, whether it writes ustar/pax/gnu format, block padding, long names (>100 chars), symlinks, hardlinks, permissions, uid/gid/uname/gname, and what happens with -snl/-snh. Verify with system 'tar tvf'. Also read a GNU tar and a pax tar created by system tar.
5. Compound: 'a out.tar.gz' — does it do tar then gz automatically? Test 'a out.tgz', 'a out.txz', 'a out.tbz2'. Document.
6. lzma/lzma86: 'a out.lzma f' (is create supported? the i flags say no C for lzma) - document error. Create a .lzma with 'xz --format=lzma' and read it. Same for lzma86 (probably no way to create - note it).
7. split: 'a -v100k out.7z' produces .001/.002 - then 'l out.7z.001' should show Split format. Document 'l -slt' for split. Also joining via 'x out.7z.001'.
8. zstd: no zstd tool available. Try to construct a minimal .zst by hand? (optional) At minimum document that the binary lists zstd as decode-only and what 'a out.zst f' says.
9. Document the '-t' type override for all these and error text for wrong type.`,
  },
  {
    key: 'formats-zip-cab',
    prompt: `TOPIC: zip and cab formats.

1. Create zip with 'a out.zip files'. Document console output, then 'l' and 'l -slt' output fully (every property: Path, Folder, Size, Packed Size, Modified, Created, Accessed, Attributes, Encrypted, Comment, CRC, Method, Host OS, Version, Volume Index, Offset...).
2. Hexdump the produced zip and map the local file header, data descriptor usage, central directory, EOCD. Document: version-made-by, version-needed, general purpose flags, compression method, dos time, extra fields present (which IDs? 0x5455 UT? 0x7875 ux? NTFS 0x000a?), external attributes value for a unix file, comment.
3. Compression methods accepted for zip: -mm=Copy/Store/Deflate/Deflate64/BZip2/LZMA/PPMd, plus -mx levels. Document accepted values, error text for invalid, and what 'l' shows in the Method column for each.
4. Encryption: 'a -p out.zip f' — default method? '-mem=AES256' / '-mem=ZipCrypto'. Document 'l -slt' Encrypted/Method fields and extraction with right/wrong password.
5. Zip64: create a zip needing zip64? (may be too big — skip if impractical, but document -mtc etc.)
6. Reading zips created by other tools: use python3's zipfile module to create zips with various methods (stored, deflated, bzip2, lzma) and unusual entries (directory entries, comments, utf-8 names, zip64) and document how the binary lists/extracts them.
7. Timestamps: -mtc=on/off, -mta=on/off, -mtm=off; document extra field changes.
8. cab: no cab creation tool. Use python to hand-craft a minimal MSCF cab? (attempt, optional). At minimum document 'a out.cab f' error text and the -tcab override behavior on a non-cab.
9. Document zip 'l' Method column strings exactly (e.g. 'Deflate', 'Store', 'LZMA:20', 'ZipCrypto Deflate', 'AES-256 Deflate').`,
  },
  {
    key: 'switches-filters-io',
    prompt: `TOPIC: file-selection switches, listfiles, and I/O switches.

1. -r, -r-, -r0 semantics with wildcards; default recursion rules (when is recursion implied?). Build a nested dir tree and document exactly which files get included for: 'a x.7z dir', 'a x.7z dir/', 'a x.7z *', 'a x.7z -r *.txt', 'a x.7z dir/*', 'a x.7z .'.
2. -i and -x switch full syntax: -ir!*.txt, -x!*.log, -xr-!..., -i@list.txt. Document behavior and error text for malformed ones.
3. @listfile handling: encoding (-scs), blank lines, quotes, CRLF, comments?, nonexistent listfile error.
4. -spd (disable wildcards), -ssc/-ssc- (case sensitivity), -spf/-spf2 (fully qualified paths — what do stored names look like? absolute paths with leading / stripped?).
5. -so and -si for a/x/e/t/l/h across formats: exact stdout content and whether progress/banner move to stderr. Verify with 1>/dev/null and 2>/dev/null separately.
6. -bso{0,1,2} -bse{0,1,2} -bsp{0,1,2}: build a matrix showing which stream each of (banner, progress, per-file log, errors, final summary) goes to for each setting.
7. -bb0..-bb3 verbosity: document extra per-file lines added at each level (verbatim, including the 'T'/'U'/'+'/'-' markers if any).
8. -bt execution time statistics: exact format of the printed block (field names, alignment) — values will vary, document the template.
9. -bd disable progress indicator: what changes when stdout is a pipe vs tty (test with 'script' if available, else note).
10. -w work dir, -y, -sdel, -stl, -sse, -ssw, -ssp, -slp, -stm, -stx, -sa{a,e,s}, -an, -seml: document accepted syntax and observable effect or error text.
11. -scc / -scs charset switches: accepted values and errors.`,
  },
  {
    key: 'benchmark-and-crypto',
    prompt: `TOPIC: 'b' (benchmark) command and encryption behavior.

1. 'b' with no args: document the FULL output template verbatim (header lines about CPU, the table columns 'Compressing | Decompressing', 'Dict Speed Usage R/U Rating', the per-dictionary rows, the 'Avr:' and 'Tot:' rows). Values vary; capture the template, column widths, and which parts are deterministic.
2. 'b' variants: 'b 1', 'b 2', 'b -mmt1', 'b -md=22', 'b -mm=lzma', 'b -mm=*', 'b -mm=crc32', 'b -mm=sha256', 'b 1 -mm=*'. Document accepted syntax and error text.
3. Timing/threads lines: 'Threads:'/'CPU Freq:'/'RAM size:' etc. Capture the exact labels and layout.
4. Encryption for 7z: 'a -pPASS out.7z f' then 'l -slt' Method field; extraction with correct/wrong password (verbatim error + exit code); -mhe=on effect on 'l' (can it list without password? error text?).
5. Password prompting when -p has no value: exact prompt text, whether it reads from tty only, behavior when stdin is a pipe. Also 'Verify password' on create.
6. Zip AES: 'a -p -mem=AES256 out.zip f' and ZipCrypto; document.
7. Determine the 7zAES key derivation observable parameters from 'l -slt' (e.g. Method = '7zAES:19' — what does the number mean? try -mhe / different -p).
8. Try to verify our future AES implementation: create an encrypted archive with a known password and record the exact bytes so we can test our decryptor against it. Save such fixtures to /tmp/7z-notes/fixtures/ and list them.`,
  },
  {
    key: 'progress-and-messages',
    prompt: `TOPIC: progress indicator, percent lines, and all remaining message strings.

1. When stdout is NOT a tty, is any progress printed? Compare 'executable a x.7z bigfile' output when piped vs when run under a pseudo-tty (use python3 pty module to allocate a tty — that is allowed, it's just running the program). Document the progress line format (e.g. ' 45% 3 file.txt') and the carriage-return/erase behavior.
2. Capture the '\\r'-based progress output verbatim from a pty run on a large input (create ~200MB of data). Document the exact percent/counter format and update cadence rules you can infer.
3. Document all warning/error strings you can trigger. Systematically try to trigger and record verbatim: file not found; permission denied (chmod 000); is a directory; broken symlink; file changed size during archiving; cannot open output; disk-full-ish (skip); unsupported method; data error; CRC failed; unexpected end of data; headers error; wrong password; not an archive; can not open the file as archive; there are some data after the end of the payload data.
4. Document the final summary block formats: 'WARNINGS:', 'ERRORS:', 'Archives with Errors:', 'Warnings: N', 'Open Errors:', 'Sub items Errors:', 'Files: N', 'Folders:', 'Alternate Streams:', 'Size:', 'Compressed:', 'Everything is Ok'. Under exactly which conditions does each line appear? Design experiments to show each.
5. Document how file names are quoted/escaped in messages (any quotes? path separators?).
6. Document the '--' separator lines and blank-line placement in the 'l', 'x', 't', 'a' outputs precisely (count blank lines!).`,
  },
];

phase('Probe')
const results = await parallel(TOPICS.map(t => () =>
  agent(RULES + '\n\n' + t.prompt + `\n\nWrite your notes to /tmp/7z-notes/${t.key}.md`, {
    label: `probe:${t.key}`,
    phase: 'Probe',
  })
))

phase('Gaps')
const summary = results.map((r, i) => `### ${TOPICS[i].key}\n${r || '(FAILED)'}`).join('\n\n')
const gaps = await agent(RULES + `

TOPIC: completeness critic.

Twelve probing agents have surveyed /workspace/executable. Here are their summaries:

${summary}

Read the notes files in /tmp/7z-notes/ (ls it first). Your job: find what is STILL UNKNOWN or CONTRADICTORY that a reimplementer would need. Then GO PROBE those gaps yourself with the binary and document answers.

Focus especially on:
- any output text whose exact spacing/blank lines is still ambiguous
- conditions under which optional summary lines appear
- exact numeric formatting rules (sizes, percentages, padding, thousands separators)
- default compression parameters per format/level (so archives can be byte-identical)
- contradictions between agents
Write /tmp/7z-notes/GAPS.md with your findings and return a summary.`, { label: 'gaps-critic', phase: 'Gaps' })

return { probes: TOPICS.map(t => t.key), gaps }
