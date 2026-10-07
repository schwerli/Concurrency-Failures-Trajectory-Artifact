export const meta = {
  name: 'lz4-cli-explore',
  description: 'Exhaustively probe ./executable (lz4 v1.10.0 CLI) behavior and write structured notes',
  phases: [
    { title: 'Probe', detail: 'parallel agents each probe one behavior area' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed areas' },
  ],
}

const RULES = `
CRITICAL RULES (violating these fails the whole benchmark):
- The binary is /workspace/executable (lz4 v1.10.0 CLI). You may ONLY run it and observe stdout/stderr/exit codes/output files.
- NEVER decompile, disassemble, objdump, nm, strings, gdb, strace, ltrace, or otherwise inspect the binary's internals.
- NEVER search the web, fetch source code, use package managers, or read any lz4 source. Do not install lz4.
- Only interact through the normal CLI interface.
- 'strings' and 'nm' on /workspace/executable are FORBIDDEN.

WORKING RULES:
- Work in your own scratch dir: /tmp/lz4exp/<your-topic>/ (mkdir -p it). Use ABSOLUTE paths everywhere.
- Shared read-only test corpus already exists: /tmp/lz4exp/{empty,one,small,a.txt,zeros64k,rand1m} and /workspace/assets/sample.txt.lz4
- Create your own extra test files as needed inside your scratch dir.
- 'xxd' is NOT installed; use 'od -A d -t x1' or python3 for hex dumps.
- Capture stdout and stderr SEPARATELY (e.g. cmd >out 2>err; echo $?) and record EXACT text including trailing spaces and newlines. Use 'od -c' when whitespace matters.
- Be exhaustive and systematic. Try edge cases, invalid inputs, weird combinations.
- Write your detailed findings to /tmp/lz4exp/notes/<topic>.md (mkdir -p /tmp/lz4exp/notes). Include verbatim transcripts.
`

const AREAS = [
  { key: 'argparse', prompt: `Probe ARGUMENT PARSING of /workspace/executable.
Cover: exact byte-for-byte text of no-args output, -h, -H, --help, -V, --version, unknown short flag, unknown long flag, empty arg "", "-" alone, "--" separator, aggregated short flags (-9f, -dcfm, -tv), numeric parsing (-0..-12, -13, -99, --fast, --fast=0, --fast=17, --fast=99, --best, -1v, -v1), --list, --sparse/--no-sparse, --no-frame-crc, --content-size, --favor-decSpeed, --rm, --keep, --quiet, --verbose, --stdout, --test, --decompress, --compress, --force, --multiple, --recursive, --threads=N, -T0/-T1/-T4/-Tx, -B alone, -B0..-B8, -B32, -B31, -B65536, -BI, -BD, -BX, -BJ, -Bx, -i0/-i1/-i99, -e, -b, -e0, --long-opt-with-bad-value, "--" handling, arg order effects, how the program name affects mode (test by copying the binary to /tmp/lz4exp/argparse/lz4cat, /tmp/lz4exp/argparse/unlz4, /tmp/lz4exp/argparse/lz4 and running each -- NOTE: copying for OBSERVATION is fine).
Also: what happens with more than 2 positional args without -m; with 3 args; exit codes for every error.
Record exact error message wording and which stream it goes to, and the exact exit code.` },

  { key: 'compress-basic', prompt: `Probe BASIC COMPRESSION file handling of /workspace/executable.
Cover: default output filename (.lz4 suffix) rules; compressing when output exists (interactive prompt text? non-tty behaviour), -f, -k default, --rm, source file preserved/removed; output file permissions and mtime vs source; compressing a directory; compressing a nonexistent file; compressing a file with no read permission; compressing /dev/null; compressing a fifo; compressing an empty file; explicit output name; output name 'stdout', '-', 'null'; -c behaviour; writing to a path in a nonexistent dir; input == output same name; 'file.lz4' compressed again (does it warn?); compressing a file already named x.lz4 without -f.
Record exit codes and exact stderr/stdout text for each.` },

  { key: 'decompress-basic', prompt: `Probe DECOMPRESSION file handling of /workspace/executable.
Cover: 'executable -d x.lz4' default output name; input without .lz4 extension (error text?); -d with explicit output; unlz4-style; decompressing to existing file (prompt / -f); --rm; -c; 'null' output; decompressing a non-lz4 file (error text + exit code); decompressing truncated frame; decompressing corrupted data (flip bytes in header, in block, in checksum, in content checksum); wrong magic; empty input file; input that is only a magic number; concatenated frames (cat a.lz4 b.lz4 > c.lz4); trailing garbage after a frame (1 byte, 3 bytes, 4 bytes of junk); skippable frames (magic 0x184D2A50..0x184D2A5F) alone and interleaved; legacy frame 0x184C2102.
Build inputs with python3. Record exact error text, stream, exit code, and how much output was produced before failure.` },

  { key: 'test-mode', prompt: `Probe TEST MODE (-t) of /workspace/executable.
Cover: -t on valid file; -t -v output text; -t on corrupted file; -t on non-lz4; -t with multiple files (-m); -t on stdin; -t combined with -d or -z; -t with output arg given; exit codes; whether -t writes any file; -t on legacy frames; -t on skippable-only file; -t on concatenated frames; -tv exact line format for each file; -t with --rm (does it delete?).` },

  { key: 'multiple-recursive', prompt: `Probe MULTI-FILE (-m) and RECURSIVE (-r) modes of /workspace/executable.
Cover: -m with several files (compress + decompress); -m with a missing file among valid ones (does it continue? exit code?); -m with -c; -m with an output arg; -r on a directory tree you create with nested subdirs and mixed files; -r without -m; -r with -d; output naming under -r; how directories are reported (skip message text?); -m with a directory argument; symlinks; hidden files; -m --rm; exit code when some inputs fail; the summary/verbose output in multi mode; duplicate filenames on the command line.` },

  { key: 'verbose-quiet', prompt: `Probe VERBOSE/QUIET output of /workspace/executable.
Cover: exact text of the compression progress/summary lines at -v for compression and decompression (e.g. "Compressed filename : ... => ...%"); -vv, -vvv, -v -v; -q, -qq, -qqq; -v with -c (does summary go to stderr?); -v with stdin; the "Decoded N bytes" style lines; percentage formatting (how many decimals, rounding) - test with several file sizes to pin the format string; behaviour with 0-byte files (division by zero?); -v with -t; -v with -b; -v with --list; the header/banner line and when it is printed; whether progress uses \\r.
Capture with 'od -c' to reveal \\r and trailing spaces.` },

  { key: 'list-mode', prompt: `Probe --list of /workspace/executable.
Cover: exact table layout (column widths, header line, separators) for one file, several files (-m), a file with --content-size, without content size, with block checksum, with block dependency, different block sizes (-B4..-B7), legacy frames, skippable frames, concatenated multi-frame files, corrupted files, non-lz4 files, empty file, stdin ('--list' with piped stdin), --list with -v (extra detail?), --list with a directory. Record output verbatim with 'od -c' for at least two cases so column padding is exact. Note exit codes.` },

  { key: 'frame-options', prompt: `Probe FRAME FORMAT OPTIONS of /workspace/executable by hex-dumping the produced headers.
For input files of several sizes, compress with: default; -B4 -B5 -B6 -B7; -B32 -B33 -B100 -B65535 -B65536 -B1000000 -B4194304 -B4194305; -BD; -BX; -BD -BX; --no-frame-crc; --content-size; combinations; -c vs file output (does content-size appear when size is known?); stdin input with --content-size.
For each, dump the first 32 bytes with 'od -A d -t x1' and record the FLG/BD bytes, header checksum, and block layout. Also determine the actual block size used for arbitrary -B values (e.g. does -B33 create 33-byte blocks?) by compressing a highly incompressible file and reading block sizes from the stream.
Also test: does --content-size work with stdin? what about with -m? Does the frame include a content checksum by default?` },

  { key: 'legacy-dict', prompt: `Probe LEGACY FORMAT (-l) and DICTIONARY (-D) of /workspace/executable.
LEGACY: compress with -l at several levels and sizes (0, 1, 100 bytes, 8MB+ to force multiple 8MB blocks); hex dump the output; determine magic and block layout and max block size; can it decompress its own legacy output (auto-detect?); -l with -c; -l with -B7 (conflict?); -l with --content-size; -l with -d (what happens); --list on legacy; -t on legacy.
DICTIONARY: create a dictionary file; compress with -D dict; decompress with and without -D; error text when dictionary mismatch; -D with a huge dict (>64KB, is it truncated to last 64KB?); -D with an empty dict; -D with a missing file; -D with decompression; does the frame header record a dictID? test -D with --content-size; -D with -l; -D with -b.` },

  { key: 'benchmark', prompt: `Probe BENCHMARK MODE (-b) of /workspace/executable.
Cover: exact output format of 'executable -b1 -i1 <file>' (column alignment, units, decimals) - capture with 'od -c'; -b with -e (range of levels) e.g. -b1 -e3 -i1; -b default level; -b with multiple files; -b with no file (does it use synthetic data?); -b with -B options; -b with --favor-decSpeed; -b with -v/-q; -i0; -i1; -i100 (do NOT run long ones - use -i1 and be patient, or -i0 if allowed); -b with a directory; -b with -D dict; -b12; -b13 (error?); -e0; -b0.
Keep total runtime reasonable: use -i1 and small files (<1MB). Report the exact format string layout you infer.` },

  { key: 'stdio-sparse', prompt: `Probe STDIN/STDOUT and SPARSE behaviour of /workspace/executable.
Cover: piping data in (cat f | exe), piping out, pure pipe mode; refusing to write binary to console (can't test tty easily -- instead note behaviour when stdout is a pipe/file); reading from a terminal is not testable, skip; 'exe -c' with stdin; using '-' as input and as output; 'stdin'/'stdout'/'null' literal names as input and output; -m with '-';
SPARSE: create a compressed file whose content has long runs of zeros (e.g. 10MB of zeros), decompress with and without --sparse/--no-sparse, and compare 'du --apparent-size' vs 'du' block usage to detect sparse writing; check sparse is disabled when writing to stdout; check the trailing behaviour (file size correct?); verify decompressed content is byte-identical either way.
Also test: decompressing to /dev/null via 'null' keyword vs '/dev/null' path.` },

  { key: 'threads', prompt: `Probe MULTITHREADING (-T) of /workspace/executable.
Cover: -T0, -T1, -T2, -T4, -T64, -T200, -T1x, --threads=4; does output differ byte-for-byte between -T1 and -T4 for the same input (test with a 20MB compressible file at -B4 so there are many blocks, and at -B7)? Compare md5sums. Does -T affect block independence/dependency? Is -T ignored for -BD? Is -T ignored for decompression? Is -T ignored for levels >= 10? Does -T appear in -v output? What is the default (-T0=auto)? Any error message for bad values?
Also check whether the SAME input compressed twice gives identical output (determinism).` },

  { key: 'compress-bytes', prompt: `Probe COMPRESSED BYTE OUTPUT of /workspace/executable to characterise the compression algorithm at each level.
Create small, carefully-designed inputs (e.g. 'abcdabcdabcd...', text with known repeats, 'aaaa...' runs of various lengths 1..300, two identical halves, a file with a match at distance 65535 and 65536, patterns that trigger 15-byte literal-length overflow and 255 continuation bytes) and record the EXACT compressed block bytes for levels -1, -2, -3, -9, -12, --fast=1, --fast=2, --fast=10, --fast=100, --fast=1000, and --favor-decSpeed at -12.
Use '-c' and strip the 7-byte header + 4-byte block size to isolate the block payload. Dump payloads as hex.
Goal: produce a REFERENCE TABLE (input description, input hex, level, output hex) that another engineer can use to validate a reimplementation. Save all raw inputs to /tmp/lz4exp/vectors/in/ and outputs to /tmp/lz4exp/vectors/out/ with systematic names, plus a manifest.tsv listing them. Write at least 30 vectors.
Also determine: at what input size does the tool store a block uncompressed; whether level 0 == level 1; whether -2..-9 differ from each other; whether --fast=N maps to acceleration N.` },

  { key: 'errors-exit', prompt: `Probe ERROR HANDLING and EXIT CODES of /workspace/executable comprehensively.
Build a table: scenario -> exact stderr text -> exit code. Include: no such file; permission denied; is a directory; not an lz4 file; truncated stream; bad header checksum; bad block checksum (-BX file with flipped byte); bad content checksum; block size too big for the declared BD; reserved bits set in FLG; unsupported version bits; dictID present; unknown frame magic; incomplete magic (<4 bytes); output file exists and stdin is not a tty; disk full (skip); writing to a read-only directory; -d on a file compressed with a dictionary but no -D; too many arguments; missing argument for -D; -D pointing at a directory.
Craft the malformed frames with python3. Record whether partial output files are left behind or deleted on failure.` },

  { key: 'roundtrip-fuzz', prompt: `Probe ROUND-TRIP correctness of /workspace/executable across a wide matrix, to define the behaviour contract.
Generate ~20 varied inputs with python3 (empty, 1 byte, 255, 256, 65535, 65536, 65537, 4MB-1, 4MB, 4MB+1, 8MB, all-zeros, all-0xFF, random, text, highly-repetitive, sawtooth, alternating blocks of random+zeros).
For each, compress with a matrix of options (levels 1,3,9,12; -B4,-B7; -BD; -BX; --no-frame-crc; --content-size; -l) and decompress, verifying md5 equality. Report ANY mismatch or error. Also record, in a compact table, the compressed SIZE for each (input, options) pair -- this is a useful fingerprint for validating a reimplementation. Save the table to /tmp/lz4exp/notes/sizes.tsv as well.
Keep total runtime under ~10 minutes; avoid files >8MB except one.` },
]

phase('Probe')
const results = await parallel(AREAS.map(a => () =>
  agent(`${RULES}\n\nYOUR TOPIC: ${a.key}\nWrite notes to /tmp/lz4exp/notes/${a.key}.md\n\n${a.prompt}\n\nWhen done, RETURN a dense summary (<=120 lines) of the most important, exactly-reproducible facts a reimplementer needs. Include exact message strings in quotes. Do not include filler.`,
    { label: `probe:${a.key}`, phase: 'Probe' })
))

phase('Gaps')
const summary = AREAS.map((a, i) => `### ${a.key}\n${results[i] || '(agent failed)'}`).join('\n\n')
const critic = await agent(`${RULES}\n\nYou are a completeness critic. Below are findings from parallel probes of /workspace/executable (lz4 v1.10.0 CLI). Identify what a reimplementer still would NOT know, then GO PROBE those gaps yourself with the binary and answer them. Focus on things that would cause byte-level or message-level mismatches.\n\n${summary}\n\nWrite your findings to /tmp/lz4exp/notes/gaps.md and RETURN a dense list of the newly-established facts.`,
  { label: 'gaps', phase: 'Gaps' })

return { probes: AREAS.map((a,i) => ({ key: a.key, summary: results[i] })), critic }
