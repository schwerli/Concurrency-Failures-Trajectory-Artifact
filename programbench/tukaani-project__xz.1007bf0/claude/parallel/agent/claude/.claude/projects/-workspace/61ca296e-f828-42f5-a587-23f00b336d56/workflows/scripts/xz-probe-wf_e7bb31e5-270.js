export const meta = {
  name: 'xz-probe',
  description: 'Exhaustively probe the xz 5.8.2 reference binary and write behavioral specs to /workspace/notes',
  phases: [
    { title: 'Probe', detail: '12 parallel probes of distinct CLI/format areas' },
    { title: 'Gaps', detail: 'completeness critic finds unprobed areas' },
  ],
}

const RULES = `
CRITICAL RULES (violating these fails the whole benchmark):
- The binary under study is /workspace/executable (xz 5.8.2). You may ONLY run it and read its output.
- You MUST NOT decompile, disassemble, objdump, nm, strings, gdb, strace, or ltrace it.
- You MUST NOT search the web or any package registry for xz/liblzma source code.
- You MUST NOT install xz, apt-get source, cargo/pip/npm install, or read any copy of the original source.
- Only allowed inputs: running /workspace/executable with flags/stdin, and reading /workspace/doc/*.txt, /workspace/README, /workspace/NEWS.
Work in a scratch dir you create under /tmp (e.g. /tmp/probe-<yourarea>). Never modify /workspace/executable.
The system 'xz' command may or may not exist; do NOT use any xz other than /workspace/executable.

OUTPUT: Write a thorough, precise markdown spec to the given path. It will be read by engineers
re-implementing xz from scratch in C, who will NOT have access to the binary transcript.
Be exhaustive and literal: include EXACT output text (copy-paste verbatim, preserving spacing),
exact exit codes, exact byte layouts (hex), and exact edge-case behavior.
Use 'od -A d -t x1' for hex dumps (xxd is not installed).
Prefer tables of {input -> exact output}. Quote whitespace-sensitive output inside fenced code blocks.
Return ONLY a <=200 word summary of what you found; the detail goes in the file.
`;

const PROBES = [
  {
    key: 'cli-args',
    file: '/workspace/notes/01-cli-args.md',
    task: `Document xz's command-line ARGUMENT PARSING exhaustively.
- Exact verbatim text of --help, --long-help, --version, --robot --version, --filters-help. (Note: help text uses argv[0] as program name - document exactly how.)
- Behaviour when invoked under different argv[0] names: copy/symlink the binary to names xz, unxz, xzcat, lzma, unlzma, lzcat, lzcat, xzdec, and also names containing those as substrings (e.g. 'myunxz', 'foo-xzcat', 'lzmafoo'). Determine the exact rule used to derive default operation mode and format from argv[0]. Test names like 'unxz-5.8', 'xz.exe'. Document precedence when explicit flags also given.
- Every short option and long option: which take args, optional args, abbreviation of long options (getopt_long prefix matching, e.g. --dec, --com, ambiguous prefixes), '--' end of options, options after filenames, repeated/conflicting options (e.g. -d -z, -c -t, -l -d), last-one-wins vs error.
- Exact error text and exit code for: unknown long option, unknown short option, missing required argument, invalid argument values for -T/-S/-C/-F/-M/--block-size/--block-list/--flush-timeout, out-of-range preset digits, -e with -0..-9 combinations.
- Behaviour of -q, -qq, -v, -vv, -Q, --no-warn on exit status.
- Environment variables XZ_OPT and XZ_DEFAULTS: how they are parsed (word splitting, quoting), precedence vs argv, what happens on error inside them (exact message). Test quoting with backslash and single/double quotes.
- Exit codes for all the above.`,
  },
  {
    key: 'file-io',
    file: '/workspace/notes/02-file-io.md',
    task: `Document xz's FILE HANDLING behaviour.
- Default suffix rules: which suffix is appended when compressing (.xz, .lzma with --format=lzma, .lz?), and the mapping when decompressing (.xz->'', .txz->.tar, .lzma->'', .tlz->.tar, .lz->''), -S/--suffix custom suffix in both directions, --format=raw requiring -c or -S. Exact warning/error messages when the suffix is unknown ("filename has an unknown suffix, skipping").
- -k, -f, -c interactions; when is input file deleted; file permissions/ownership/timestamps copied to output (test with chmod 0640, setuid bits, mtime preservation - use 'stat').
- Output file already exists: exact message + exit code, with and without -f.
- Reading from a terminal / writing to a terminal: exact refusal messages ("Compressed data cannot be written to a terminal" etc). Simulate with 'script -qc' if available, else document what you can.
- Symlinks, directories ("... is a directory, skipping"), FIFOs, /dev/null, files with multiple hard links (exact warning), unreadable files, empty files, files named '-' vs the '-' stdin token.
- --files and --files0: format, empty lines, missing file, exact errors, '-' inside the list, reading list from stdin.
- Exit codes: 0 success, 1 error, 2 warning. Determine precisely which conditions give 2. Test -Q/--no-warn effect.
- Behaviour when the same file is given twice; when compressing an already-.xz file (exact warning); when decompressing a file with trailing garbage (exact message).
- --no-sparse / sparse output behaviour when decompressing long runs of zeros (check with 'du' and 'stat -c %b').
- --no-sync. Signal handling / partial output cleanup (test by killing mid-run with a big file; is the partial output file removed?).`,
  },
  {
    key: 'list',
    file: '/workspace/notes/03-list.md',
    task: `Document the --list (-l) output EXACTLY, character-for-character, including column widths and alignment.
Cover: -l, -lv, -lvv, --robot -l, --robot -lv, --robot -lvv.
- Build many sample files: empty input, tiny, 1 byte, 1 KiB, 1 MiB, 10 MiB; different checks (none/crc32/crc64/sha256); multiple blocks (--block-size, --block-list); multiple concatenated streams (cat a.xz b.xz); stream padding (append 4/8 zero bytes); files with different filters (--delta, --x86, --lzma2=dict=...); multiple input files at once (the "totals" line); -l on .lzma files; -l on .lz files; -l on non-xz files; -l on truncated/corrupt files (exact error text and exit codes); -l with -q.
- Determine EXACT number formatting: the human-readable size formatting function (B / KiB / MiB / GiB / TiB thresholds and decimal digits), the ratio formatting (3 decimals, and what is printed when uncompressed size is 0 -> '---'?), the check name strings, the 'Unknown-N' names for unknown check IDs.
- Document the -lvv extra columns: CheckVal, Header, Flags (the 'cu'/'c'/'u'/'-' encoding), CompSize, MemUsage, Filters (the exact --lzma2=dict=8MiB style rendering, incl. delta/BCJ/lzma1 rendering, and dict size rendering like 8MiB / 1536MiB / 4096KiB).
- The trailing summary lines: "Memory needed:", "Sizes in headers:", "Minimum XZ Utils version:" - determine the rules that pick the minimum version (5.0.0 vs 5.2.0 vs others) by trying many filter/check combos.
- The --robot -l line formats: name/file/stream/block/summary/totals fields, exact tab separation and field meanings.
- The totals line when multiple files are listed, and with 0 files.
Write down the exact printf format strings you infer.`,
  },
  {
    key: 'xz-container',
    file: '/workspace/notes/04-xz-container.md',
    task: `Reverse the .xz CONTAINER byte layout produced by the encoder (not the LZMA payload itself).
Read /workspace/doc/xz-file-format.txt first - it is the authoritative spec, summarise the parts needed.
Then determine empirically:
- Stream header/footer bytes for each --check value (none, crc32, crc64, sha256) and the backward size encoding.
- Block header layout in SINGLE-THREADED mode (-T1) vs MULTI-THREADED (default / -T2+): why MT writes Compressed Size and Uncompressed Size fields and how much padding is reserved. Derive the exact formula for the reserved block header size as a function of the block size and filter chain. Test presets 0..9 and explicit --block-size values (e.g. 1, 100, 4096, 1MiB, 100MiB) and dict sizes.
- Default MT block size per preset (derive from where block boundaries land with a big incompressible input): test -T2 with a 50MB random file at presets 0,1,3,6,9 and count blocks with -lvv.
- --block-size=N and --block-list=... semantics incl. filter-chain prefixes "1:100,2:200", trailing commas, 0 sizes, interaction with -T1 vs MT, and whether the last block is short.
- Index encoding and Stream Footer; padding rules; empty input (0 blocks) exact bytes for each preset/check.
- Concatenated streams on decode; stream padding (multiples of 4 zero bytes) accepted/rejected; exact error messages for corrupt magic, bad CRC, unsupported check, truncated file, trailing garbage.
- --single-stream and --ignore-check behaviour.
Provide annotated hex dumps for at least 10 representative files.`,
  },
  {
    key: 'lzma-alone-lzip',
    file: '/workspace/notes/05-alone-lzip-raw.md',
    task: `Document the legacy .lzma (LZMA_Alone) and .lz (lzip) formats and --format=raw as implemented here.
Read /workspace/doc/lzma-file-format.txt first.
- --format=lzma encoding: exact 13-byte header for presets 0..9 and custom --lzma1=... options (props byte = (pb*5+lp)*9+lc, dict size little-endian 32-bit, uncompressed size field: when is it 0xFFFFFFFFFFFFFFFF vs a known size? test file input vs stdin vs -T1 vs default threads). Does .lzma support threads? Exact error if unsupported options are used (lc+lp>4 etc).
- .lzma decoding: end marker handling, known-size handling, what dict sizes are accepted, error messages for corrupt/truncated input, memory limit behaviour, and how 'auto' format detection distinguishes .lzma from raw garbage (document the heuristic precisely by feeding crafted 13-byte headers).
- .lz (lzip) DECODING: which versions are accepted, the header/footer layout, multi-member files, exact error messages. Is lzip ENcoding supported (test --format=lzip -z)?
- --format=raw: which flags are required (does it demand --filters/--lzma1/--lzma2? does it require -c or a suffix?), exact error messages when the filter chain is unspecified on decode, and byte output for simple chains. Confirm raw streams have no header/footer/check.
- Format auto-detection order and messages when a file matches none.
Provide annotated hex dumps.`,
  },
  {
    key: 'presets',
    file: '/workspace/notes/06-presets.md',
    task: `Determine the EXACT LZMA/LZMA2 parameter table for presets -0..-9 and -0e..-9e.
Use observable signals: (a) the LZMA2 dict-size property byte in the block header / .lzma header gives dict size exactly;
(b) 'xz -lvv' prints the filter chain; (c) '--lzma1=preset=N' + '--format=lzma' header bytes give lc/lp/pb exactly (props = (pb*5+lp)*9+lc);
(d) memory usage numbers from 'xz -9 --info-memory'-style probes and from '-lvv' MemUsage, plus '--memlimit-compress=X' with '--no-adjust' error text which prints required memory - this reveals the encoder memory formula, which depends on dict size, match finder, and depth;
(e) compressed output byte-differences when overriding one parameter at a time with --lzma2=preset=N,mode=...,nice=...,mf=...,depth=... : find the override values that reproduce the preset output byte-for-byte, which pins mode/nice/mf/depth.
Produce a definitive table: preset -> dict, lc, lp, pb, mode(fast/normal), nice_len, mf(hc3/hc4/bt2/bt3/bt4), depth. Both plain and -e (extreme) variants.
Also determine: what -e does when combined with explicit --lzma2 options and ordering rules (does -e before/after -9 matter?), and what 'preset=9e' inside --lzma2 does.
Also record the exact 'MemUsage' values -lvv prints for each preset (decoder memory) and the encoder memory reported by --no-adjust errors, as a formula.`,
  },
  {
    key: 'filters-syntax',
    file: '/workspace/notes/07-filters-syntax.md',
    task: `Document the --filters / --filters1..9 liblzma FILTER STRING syntax and all the --lzma1/--lzma2/--delta/--x86/... option parsing.
- Verbatim text of --filters-help.
- Full grammar: filter names accepted, separators ('--' between filters? ',' between options?), option=value forms, integer suffixes (KiB/MiB/GiB/k/m/g, case sensitivity, 'KB' vs 'KiB'), boolean/enum values, ranges and exact out-of-range error messages for every option of every filter.
- Exact error messages: unsupported filter name, unsupported option name, invalid value, too many filters (max 4), invalid chain order (e.g. lzma2 not last, delta after lzma2, two lzma2), BCJ+delta combos, using lzma1 in .xz format, using lzma2 in .lzma format, filters that are decode-only.
- --lzma2=preset=6e,dict=...,lc=,lp=,pb=,mode=,nice=,mf=,depth= : all values, error text for lc+lp>4, dict out of range (test 4KiB min, 1536MiB max, non-power-of-2), nice range 2..273, depth range.
- Delta dist range 1..256. BCJ start=NUM ranges and alignment requirements (e.g. x86 start must be multiple of 1? arm 4? ia64 16? riscv 2?) - test invalid values for each BCJ filter and record errors.
- How --filters interacts with -0..-9 and -e (which wins, ordering).
- How the chain is rendered back by 'xz -lvv' (round-trip the rendering).
- Whether --filters accepts the same syntax as -lvv prints.`,
  },
  {
    key: 'bcj-delta',
    file: '/workspace/notes/08-bcj-delta.md',
    task: `Determine the EXACT byte transformations of the Delta filter and every BCJ filter (x86, arm, armthumb, arm64, powerpc, ia64, sparc, riscv).
Method: use '--format=raw --filters=<filter>' (encode) and its inverse (decode) with -c, on crafted inputs, so you see the transform in isolation with no LZMA layer. If raw mode requires an lzma filter, instead chain '<bcj> --lzma2=...' and compare, or better: find a way to observe the filter alone (raw with only the BCJ filter should be allowed since BCJ filters are non-last... verify; if the chain must end with lzma1/lzma2, then use delta/bcj + lzma2 with preset 0 and decode the lzma2 layer separately, OR use the identity trick: compress with the filter then decompress with only the lzma layer).
Simplest reliable approach: for each filter F, run: printf <bytes> | ./executable --format=raw --filters=F -c > out ; and also decode. Determine whether raw allows a lone BCJ filter.
For each filter document: the exact scanning algorithm, alignment, which opcodes are matched, the endianness and bit-field layout of the converted immediate, the delta between absolute and relative addressing, the effect of the 'start' offset, and the x86 filter's stateful prev_mask/prev_pos logic (probe with many crafted x86 byte patterns: sequences of E8/E9 with various following bytes, back-to-back calls, calls near buffer end).
Give exhaustive input->output byte vectors (hex) for each filter, enough to validate a reimplementation, including multi-chunk/streaming boundary behaviour (feed data larger than the internal buffer).
Delta: dist 1..4 and 256, multi-chunk continuity.`,
  },
  {
    key: 'memlimit',
    file: '/workspace/notes/09-memlimit.md',
    task: `Document memory-limit handling and --info-memory.
- Exact verbatim output of --info-memory and --robot --info-memory (note the machine here has 128792 MiB RAM / 64 threads; describe the formula, e.g. default mt-decompress limit = 25% RAM, default -T0 limit).
- -M/--memlimit, --memlimit-compress, --memlimit-decompress, --memlimit-mt-decompress: accepted syntaxes (bytes, K/KiB/M/MiB/G/GiB, percentages like 40%, 0 for default, 'max'), exact error messages for invalid values, and interaction/precedence when several are given.
- Behaviour when the compression settings exceed the limit: the automatic downgrade (which preset/dict it drops to), the exact warning text, and the exact error text with --no-adjust. Do this for many limits (e.g. 1MiB, 10MiB, 100MiB) and presets to derive the ENCODER MEMORY USAGE FORMULA per match finder (hc3/hc4/bt2/bt3/bt4) and dict size. This formula is needed for a faithful reimplementation.
- Same for decompression: exact error "Memory usage limit reached" text incl. the numbers, and the DECODER memory formula (roughly dict_size + overhead) for lzma1/lzma2/delta/bcj chains.
- Threaded decompression memory behaviour and how the thread count is reduced.
- Exit codes in each case.
Give a table of {preset, mf, dict} -> encoder memory bytes, and derive closed-form formulas.`,
  },
  {
    key: 'verbose',
    file: '/workspace/notes/10-verbose-messages.md',
    task: `Document the -v / -vv progress and statistics output when compressing and decompressing.
- Exact verbatim final statistics line(s) printed to stderr with -v for: compressing a file, decompressing a file, -t testing, stdin/stdout, multiple files, empty file, and with --robot.
- The column layout and the human-readable size/speed/time formatting ("100.0 %", "1,234 B", "12.3 MiB", "0.0 s", "12 MiB/s"), and the ratio field and check name field.
- Progress indicator behaviour when stderr is not a terminal (probably suppressed) vs terminal.
- --robot output lines for progress/totals during compression/decompression/test.
- What -vv adds over -v (e.g. printing the filter chain / memory usage before coding: exact text).
- Messages printed for warnings/errors with -q and -qq.
- Also document the exact text of common runtime messages: "Compressed data cannot be written to a terminal...", "Cannot read data from a terminal...", "%s: Filename has an unknown suffix, skipping", "%s: File already has '%s' suffix, skipping", unexpected EOF, "Unsupported check", etc. Grep for them by triggering each condition.`,
  },
  {
    key: 'decoder-errors',
    file: '/workspace/notes/11-decoder-errors.md',
    task: `Systematically corrupt valid .xz/.lzma/.lz files and record the EXACT error message and exit code for each corruption class.
Build a valid multi-block, multi-stream .xz file. Then, for each of these, produce the message:
- wrong magic bytes; bad stream flags CRC; unsupported check type (patch check id to 0x05/0x0A/0x0F); reserved flag bits set; bad block header CRC; unsupported filter id; bad filter properties; block header size 0; truncation at every structural boundary (after header, mid-block, before index, mid-index, before footer, mid-footer); wrong index CRC; wrong index record count/sizes; wrong footer backward size; wrong check value (data error); trailing garbage after footer; stream padding not multiple of 4; non-zero stream padding.
Also for .lzma: bad props byte (>=225), dict size 0/huge, truncated, wrong end marker, size mismatch.
Also test: -t on each, -l on each, -d on each - the messages may differ. And with --ignore-check, --single-stream, -q, -qq.
Record which errors are "warnings" (exit 2) vs "errors" (exit 1).
Present a table: corruption -> exact stderr text -> exit code, for -d, -t, and -l.`,
  },
  {
    key: 'lzma2-stream',
    file: '/workspace/notes/12-lzma2-chunking.md',
    task: `Reverse-engineer the LZMA2 CHUNK LAYER as produced by this encoder (not the LZMA range coder itself).
Use '--format=raw --filters=lzma2:preset=N' (or --lzma2=preset=N) with -c to get bare LZMA2 streams.
Determine:
- Control byte encoding: 0x00 end, 0x01/0x02 uncompressed chunks (reset dict / no reset), 0x80..0xFF compressed chunks with the 2-bit reset mode and the 5 high bits of unpacked size. Confirm against /workspace/doc/xz-file-format.txt.
- Exact chunk size limits used by THIS encoder: max uncompressed chunk size (2 MiB?) and max compressed chunk size (64 KiB?), and when it decides to emit an UNCOMPRESSED chunk instead of a compressed one (feed incompressible random data and observe: is there a 'compressed >= uncompressed' fallback? at what granularity?).
- The reset behaviour of the first chunk (props+state+dict reset) and subsequent chunks, and after a flush (--flush-timeout / block boundaries).
- Behaviour of dictionary reset at block boundaries with --block-size and in MT mode.
- Empty input: what does an empty LZMA2 stream look like.
- Data larger than the dict size.
Provide annotated hex dumps of chunk headers for: 1 byte, 100 bytes, 100 KiB text, 1 MiB text, 3 MiB random, 3 MiB zeros. Show exact chunk boundary offsets and unpacked/packed sizes.`,
  },
];

phase('Probe')
const results = await parallel(PROBES.map(p => () =>
  agent(`${RULES}\n\nWrite your spec to: ${p.file}\n\nTASK:\n${p.task}`,
    { label: `probe:${p.key}`, phase: 'Probe' })
));

phase('Gaps')
const gaps = await agent(
  `${RULES}\n\nRead all files in /workspace/notes/ (they are behavioral specs of /workspace/executable, xz 5.8.2).\n` +
  `Act as a COMPLETENESS CRITIC for a team that must re-implement xz from scratch in C and match it byte-for-byte.\n` +
  `Identify what is MISSING, ambiguous, or contradictory across the notes. Then GO PROBE those gaps yourself with the binary and write the answers to /workspace/notes/13-gaps.md.\n` +
  `Focus especially on anything needed for byte-identical compressed output and character-identical terminal output.\n` +
  `Return a <=250 word list of remaining unknowns.`,
  { label: 'gap-critic', phase: 'Gaps' });

return { probes: results.map((r, i) => ({ area: PROBES[i].key, ok: r != null })), gaps }
