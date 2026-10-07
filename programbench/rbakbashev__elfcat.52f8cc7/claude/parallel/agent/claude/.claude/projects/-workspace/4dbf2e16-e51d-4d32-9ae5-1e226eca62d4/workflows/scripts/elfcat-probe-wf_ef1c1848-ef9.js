export const meta = {
  name: 'elfcat-probe',
  description: 'Parallel behavioral probing of the elfcat binary to enumerate all lookup tables and formatting rules',
  phases: [
    { title: 'Probe', detail: 'independent probes of distinct output facets' },
  ],
}

const COMMON = `
You are reverse-engineering a binary at /workspace/executable by BEHAVIORAL OBSERVATION ONLY.
It is "elfcat 0.1.10", a tool that reads an ELF file and writes <name>.html to CWD.

ABSOLUTE RULES (violating = task failure):
- NEVER decompile, disassemble, or use objdump/nm/readelf/strings/ghidra/gdb/strace/ltrace ON /workspace/executable.
- NEVER search the web or package registries for elfcat source code. Do not clone/download anything.
- You MAY only run /workspace/executable with crafted input files and read its HTML output.
- You MAY use readelf/objdump on files YOU create.

A Python toolkit already exists at /tmp/kit/elfkit.py. Read it first. Use it like:
    import sys; sys.path.insert(0, '/tmp/kit')
    from elfkit import *
    h = run(build(phdrs=[dict(ptype=1, off=0x100, filesz=0x10)], filesize=0x200))
    print(fileinfo(h)); print(itables(h).keys()); show_ranges(h)
Helper functions: build(), run(), err(), fileinfo(), itable(), itables(), itable_rows(),
connects(), highlights(), div(), span_ranges(), show_ranges(), starts_at(), ends_at(),
open_close_events().
IMPORTANT: work in your own scratch dir (the toolkit already uses a private tempdir via workdir()).
Do not modify /tmp/kit/elfkit.py (other agents share it); copy it if you need changes.

Known baseline facts (do not re-derive):
- Output HTML skeleton is fixed boilerplate; only these parts vary: <title>, the fileinfo
  <table>, #offsets, #bytes, #ascii, the info tables inside #sticky_table, the
  highlightClasses() call list, "let fileLen = N", and the connect() call list.
- #bytes is a hexdump: 16 bytes/line, bytes separated by a space (or a newline at each
  16-byte boundary), with nested span markers. The renderer keeps a per-byte list of
  range-starts and a per-byte COUNT of range-ends (recorded at index end-1), and pops the
  span stack blindly, so overlapping ranges produce mismatched-looking nesting. Expected.
- Errors seen so far: Failed to read file "X": <io err> (os error N);
  Failed to parse ELF: file is smaller than ELF header's e_ident;
  Failed to parse ELF: mismatched magic: not an ELF file;
  Failed to parse ELF: Unknown bitness: N; Failed to parse ELF: Unknown endianness: N;
  Failed to parse ELF: file is smaller than ELF file header.
- e_machine table: 0=None,1=AT&T WE 32100,2=SPARC,3=x86,4=Motorolla 68000,5=Motorolla 88000,
  6=Intel MCU,7=Intel 80860,8=MIPS,9=IBM System/370,10=MIPS RS3000 little-endian,
  14=HP PA-RISC,19=Intel 80960,20=PowerPC,21=PowerPC 64-bit,22=S390,40=ARM Aarch32,
  50=Itanium IA-64,62=x86-64,183=ARM Aarch64,190=CUDA,224=AMDGPU,243=RISC-V, else "Unknown: N".
- e_type: 0="None (NONE)",1="Relocatable object file (REL)",2="Executable file (EXEC)",
  3="Shared object file (DYN)",4="Core file (CORE)",0xfe00/0xfeff="Environment-specific use",
  0xff00/0xffff="Processor-specific use", else "Unknown N".
- osabi: 0=SysV,1=HP-UX,2=NetBSD,3=Linux,4=Hurd,6=Solaris,7=AIX,8=IRIX,9=FreeBSD,10=Tru64,
  11=Modesto,12=OpenBSD,13=OpenVMS,255=Standalone, else "Unknown: N".

WRITE YOUR FINDINGS to the file path given in your task, as precise, exhaustive Markdown:
exact literal output strings, exact conditions, exact numbers. Include the raw evidence
(the exact HTML fragments) for anything subtle. Be exhaustive; another engineer will
reimplement byte-for-byte from your notes alone. Your final message should be a concise
summary (max 40 lines) plus the file path.
`

const TASKS = [
  {
    key: 'ptype',
    file: '/tmp/findings/ptype.md',
    prompt: `Enumerate EXACTLY how elfcat renders p_type (segment type) everywhere it appears.
It appears as the "Type:" row of info_phdrN tables and info_segmentN tables.
Probe every p_type value that could plausibly be named: 0..64, and the OS/proc ranges
0x60000000-0x6fffffff (esp. 0x6474e550-0x6474e560, 0x6ffffffa-0x6fffffff), 0x70000000-0x7fffffff
(esp. 0x70000000-0x70000010, 0x7ffffffa-0x7fffffff), plus boundary values
0x5fffffff,0x60000000,0x6fffffff,0x70000000,0x7fffffff,0x80000000,0xffffffff.
Do a SMART SWEEP: first scan coarse ranges to find where named values live, then exhaustively
enumerate every value in those neighborhoods. Also scan 0..0x100 exhaustively and a random
sample across the whole u32 space to make sure you have not missed a table entry.
Known data points: 6=PHDR, 3=INTERP, 1=LOAD, 2=DYNAMIC, 4=NOTE, 0x6474e553 renders
"Unknown: 1685382483", 0x6474e550="GNU_EH_FRAME (OS-specific)", 0x6474e551="GNU_STACK (OS-specific)",
0x6474e552="GNU_RELRO (OS-specific)".
Report the complete value->string table and the exact fallback format(s) (note: some elfcat
tables use "Unknown: N" and others "Unknown N" -- determine which is used here, and exactly
which values get a suffix like " (OS-specific)" or " (processor-specific)").
Also determine: is the string in info_phdrN identical to the one in info_segmentN?`,
  },
  {
    key: 'shtype',
    file: '/tmp/findings/shtype.md',
    prompt: `Enumerate EXACTLY how elfcat renders sh_type (section type) everywhere it appears:
the "Type:" row of info_shdrN and info_sectionN tables.
Probe 0..64 exhaustively, the OS range 0x60000000-0x6fffffff (esp 0x6ffffff0-0x6fffffff and
0x60000000-0x60000010), proc range 0x70000000-0x7fffffff (esp 0x70000000-0x70000010 and
0x7ffffff0-0x7fffffff), user range 0x80000000-0x8fffffff, and 0xffffffff.
Known data points: sh_type 0x6fffffff renders as "HIOS", 0x6ffffffe renders as
"VER_NEED (OS-specific)", 0x6ffffff6 renders as "GNU_HASH (OS-specific)",
0=NULL,1=PROGBITS,2=SYMTAB,3=STRTAB,4=RELA,8=NOBITS,6=DYNAMIC,7=NOTE,11=DYNSYM,
14=INIT_ARRAY,15=FINI_ARRAY. So there is a suffix convention -- pin down EXACTLY which
values get which suffix and which get a bare name.
Do a smart sweep first (coarse), then exhaustive in the interesting neighborhoods.
Report the complete table and fallback format. Also confirm info_shdrN and info_sectionN
render the same string.
IMPORTANT: sections with size 0 or type NOBITS(8) get no #bytes range but their info tables
still exist. Use a nonzero size and a type-under-test.`,
  },
  {
    key: 'flags',
    file: '/tmp/findings/flags.md',
    prompt: `Determine EXACTLY how elfcat renders p_flags (in info_phdrN "Flags:" row) and
sh_flags (in info_shdrN "Flags:" row).
Known data points: p_flags=4 -> "R", 5 -> "RX", 6 -> "RW". sh_flags=0 -> "0", sh_flags=2 -> "A".
Probe ALL p_flags values 0..15 and then high bits: 0x8,0x10,0xff,0xf0000000,0x0ff00000,
0xffffffff, and each single bit 1<<0 .. 1<<31.
Probe ALL sh_flags values: each single bit 1<<0 .. 1<<63 (sh_flags is u64 on 64-bit,
u32 on 32-bit -- check both), plus combinations 0..0xfff, and 0xffffffffffffffff.
Report the exact rendering rule: which characters/letters for which bits, ordering,
separator, what happens with unknown bits, and what is printed when the result is empty.
Also check whether sh_flags rendering differs between 32-bit and 64-bit ELF.`,
  },
  {
    key: 'numfmt',
    file: '/tmp/findings/numfmt.md',
    prompt: `Determine EXACTLY elfcat's number formatting rules. There are several distinct
formats in the output:
(a) fileinfo "File size:" -- e.g. "64 B", "512 B", "15.6 KiB (15960 B)".
(b) fileinfo "Entrypoint:" -- span class='number' title='4096' body 0x1000  (title=decimal, body=hex)
(c) fileinfo Program/Section headers -- span title='0xd' class='number fileinfo_e_phnum' body 13
    (title=hex, body=decimal)
(d) info table "Offset in file:" / "Vaddr in memory:" / "Alignment:" ->
    span class='number' title='64' body 0x40  (title=decimal, body=hex)
(e) info table "Size in file:" / "Size in memory:" / "Size:" ->
    span class='number' title='0x628' body "1576 (1.5 KiB)" (title=hex, body=decimal + optional human suffix)
Pin down EXACTLY:
1. The "File size" format for every magnitude: 0,1,1023,1024,1025,1536,10240,1048575,
   1048576,1048577,1073741824, and larger if feasible (create large files with a valid ELF
   header plus padding; you can use sparse files via seek/truncate). What units exist
   (B, KiB, MiB, GiB, TiB)? How many decimal places? Rounding mode (truncate vs round)?
   Exact separator/parenthesis text? When is the "(N B)" part omitted?
2. The "size" format used in info tables (e) for the same magnitudes -- use a segment
   p_filesz/p_memsz and a section sh_size (these need not be backed by real file bytes if
   that avoids panics -- but check). When does the " (X KiB)" suffix appear/disappear?
   Exact spacing and parens.
3. Whether hex is lowercase, whether the 0x prefix is always present, whether 0 renders as 0x0.
4. Any thousands separators.
Report exact literal strings for each probed magnitude in a table.`,
  },
  {
    key: 'notes',
    file: '/tmp/findings/notes.md',
    prompt: `Determine EXACTLY how elfcat parses and renders ELF notes (PT_NOTE segments).
Baseline observation from a gcc-built binary: info_segmentN for a PT_NOTE segment gets extra
rows after the size rows (exact literal text, note the two DIFFERENT blank-row spellings):
            <tr><td><br></td></tr>
            <tr> <td>Name:</td> <td>GNU</td> </tr>
            <tr> <td>Type:</td> <td>0x5</td> </tr>
            <tr> <td>Desc:</td> <td><b>02</b> <b>00</b> </td> </tr>
            <tr> <td><br></td> </tr>
            <tr> <td>Name:</td> <td>GNU</td> </tr>
            <tr> <td>Type:</td> <td>0x3</td> </tr>
            <tr> <td>Build ID:</td> <td>2f05ab9e761037d40ebcbf2c61f53ed67300e0ac</td> </tr>
Also: #bytes gets extra ranges with class "segment_subrange hover" -- one per note.
HYPOTHESIS TO TEST: notes from ALL PT_NOTE segments are collected into one global list, and
EVERY PT_NOTE segment's info table prints the WHOLE global list. Verify or refute with two
PT_NOTE segments containing different notes.
Also pin down:
- exact note record layout parsing (namesz, descsz, type; alignment/padding of name and desc:
  4-byte? 8-byte? does p_align matter? does bitness matter?)
- when is "Build ID:" used instead of "Desc:" (type==3 and name=="GNU"? any name?)
  and what is the exact hex format of the build id (lowercase, no separators, length)?
- the exact "Desc:" hex byte format: repeated <b>%02x</b> plus a space -- is there a trailing
  space before the closing td? Any cap on the number of bytes shown?
- how is the note Name rendered (NUL-stripped? escaped? empty name?)
- how is Type rendered ("0x5" -- lowercase hex with 0x prefix? for all types? any named types?)
- what happens with malformed notes (namesz/descsz huge, descsz=0, namesz=0, note extending
  past segment end, past EOF)? Does it panic, truncate, or loop forever?
- exactly which byte ranges become "segment_subrange hover" (start/end per note, incl. padding?)
- does a SHT_NOTE section (not segment) also produce notes/subranges? Test it.
Report with exact literal HTML fragments.`,
  },
  {
    key: 'strtab',
    file: '/tmp/findings/strtab.md',
    prompt: `Determine EXACTLY how elfcat renders the extra content in info_sectionN and
info_segmentN tables beyond Type/Size.
Known: a SHT_STRTAB(3) section gets these extra rows (exact literal text and indentation):
            <tr><td><br></td></tr>
            <tr>
              <td></td>
              <td>
                <div>
                  __cxa_finalize
                  __libc_start_main
                </div>
              </td>
            </tr>
And a PT_INTERP(3) segment gets:
            <tr><td><br></td></tr>
            <tr> <td>Interpreter:</td> <td>/lib64/ld-linux-x86-64.so.2</td> </tr>
Pin down EXACTLY (with literal fragments and exact indentation/whitespace):
1. STRTAB rendering: how strings are split (NUL), whether empty strings are skipped, what
   happens with a missing final NUL, whether the leading empty string is dropped, order,
   duplicates, non-UTF8 bytes, HTML-escaping of angle brackets and ampersands inside strings,
   very long strings, huge counts (is there a cap?), a strtab whose sh_offset+sh_size exceeds
   EOF, size 0, and whether the list appears in info_shdrN too or only info_sectionN.
   What is the exact indentation of each string line and the exact surrounding whitespace?
2. Interpreter rendering: NUL handling, trailing NUL stripped?, non-UTF8, empty, escaping,
   p_filesz=0, offset past EOF, and whether PT_INTERP also renders in info_phdrN.
3. Do any OTHER section types or segment types get extra rows? Systematically test every
   sh_type (0..20, SHT_DYNAMIC=6, SHT_SYMTAB=2, SHT_DYNSYM=11, SHT_NOTE=7, SHT_HASH=5,
   SHT_REL/RELA) and every p_type (0..8, PT_DYNAMIC=2, PT_NOTE=4, PT_PHDR=6, PT_TLS=7,
   GNU_* 0x6474e550..0x6474e553) and report which produce extra rows and what they look like.
4. Report the full row-by-row template of info_phdrN, info_shdrN, info_segmentN,
   info_sectionN including exact label strings and order.`,
  },
  {
    key: 'order',
    file: '/tmp/findings/order.md',
    prompt: `Determine the EXACT insertion order of byte-ranges in the #bytes hexdump, and
exactly which ranges are emitted vs skipped.
Model already established: there is a per-byte list of "range starts" (ordered) and a
per-byte COUNT of "range ends" recorded at index end-1; the emitter, for byte i, prints
separator, then all opens at i, then the byte, then one closing span tag per end at i.
Confirmed orderings: (a) at 0x40 with phoff=0x40 and a segment at 0x40, the segment span
opens BEFORE the phdr span. (b) with shoff=0x40 and a section at 0x40, order is
shdr0, sh_name, section1 -- i.e. the section opens AFTER the shdr and its field ranges.
(c) with two PT_NOTE segments and a section at the same offset the order was
segment7, segment9, section2, segment_subrange.
YOUR JOB: nail the complete global insertion order. Construct ELFs where many range kinds
start at the exact same byte offset and read starts_at(h) to get the lexical open order.
Determine the order among: ehdr/ident/field ranges, phdrN + p_ fields, shdrN + sh_ fields,
segmentN, sectionN, segment_subrange. Are all segments added before all phdrs, or per-index
interleaved? Are all shdrs added before all sections? Where do note subranges go?
Also determine EXACTLY which ranges are SKIPPED:
- segment with p_filesz==0 (observed: skipped) -- is it skipped, or does it panic?
- section with sh_size==0, section with sh_type==NOBITS(8), sh_type==NULL(0)
- ranges whose end exceeds the file length (does it panic with
  "index out of bounds: the len is L but the index is I" at src/elf/parser.rs:117:18?)
  Determine the exact clamping/panic rule for: e_ehsize>filelen, phoff+phnum*phentsize>filelen,
  shoff+shnum*shentsize>filelen, p_offset+p_filesz>filelen, sh_offset+sh_size>filelen,
  p_offset>filelen, sh_offset>filelen. For each, report whether it panics (and the exact
  panic message + which index) or silently clamps/skips.
- what happens with e_phnum/e_shnum large, e_phentsize/e_shentsize != 56/64 (does it use the
  header value as stride?), phoff==0 with phnum>0, shoff==0 with shnum>0.
Report exact rules. Include the exact panic messages and exit codes you observe.`,
  },
  {
    key: 'ascii',
    file: '/tmp/findings/ascii.md',
    prompt: `Determine EXACTLY the content of the #ascii div, the #offsets div, the #bytes
byte-text rendering, and all HTML escaping in elfcat's output.
1. #ascii: build a file containing all 256 byte values and report EXACTLY which bytes map to
   themselves and which to a dot. Report the exact HTML escaping used (e.g. > becomes &gt;).
   Test bytes 0x20 (space!), 0x7e, 0x7f, 0x80, 0xff, and the chars < > & " and single-quote.
   Confirm line length (16), the separator, and whether a trailing newline precedes the
   closing div tag. Confirm the last partial line behaviour (file size not a multiple of 16).
2. #offsets: confirm the exact content (hex offsets, lowercase?, one per line, how many lines,
   trailing newline). Test file sizes 1, 15, 16, 17, 4096, and 0x100000 if feasible.
   Report whether offsets are zero-padded.
3. #bytes: confirm bytes render as lowercase 2-digit hex; and that the EI_MAG range renders
   specially as "7f &nbsp;E &nbsp;L &nbsp;F". Determine the exact rule for that special
   rendering. Test whether the rule is "byte is printable -> render as &nbsp; followed by the
   char" and whether it applies anywhere else in the dump (it did not in a gcc binary, so
   probably only within the magic span). Report the exact rule.
4. Report the exact "let fileLen = N" line and the exact title element content (is the
   filename HTML-escaped? test a filename with < and & and a space). Also test how the
   fileinfo "File name:" cell escapes the path.
   Note: the output file is written to CWD as basename(arg) + ".html" -- verify; for arg
   "a/b/c.bin" the html went to "./c.bin.html" and the File-name cell showed "a/b/c.bin".
   Verify what the title element shows (full arg or basename?).
5. What happens for files whose size is exactly 16/52/64, and for a 1-byte-past-header file?`,
  },
  {
    key: 'bitness',
    file: '/tmp/findings/bitness.md',
    prompt: `Determine EXACTLY the differences between 32-bit and 64-bit, and little- vs
big-endian handling in elfcat's output.
1. For a 32-bit ELF (EI_CLASS=1, ehsize=52, phentsize=32, shentsize=40): report the exact
   #bytes field ranges for ehdr fields, phdr fields (note ELF32 phdr layout is
   p_type,p_offset,p_vaddr,p_paddr,p_filesz,p_memsz,p_flags,p_align) and shdr fields.
   Verify elfcat uses the correct ELF32 layout. You can build a real 32-bit binary with
   gcc -m32 if multilib is available, else craft by hand with the toolkit.
   Report which span classes appear and their exact offsets/sizes.
2. Same for big-endian (EI_DATA=2): verify multi-byte fields are decoded big-endian. Report
   the fileinfo values to prove decoding.
3. Does elfcat use e_ehsize/e_phentsize/e_shentsize from the header as strides/sizes, or
   hardcoded 52/64, 32/56, 40/64? Test with unusual values (e.g. phentsize=64 on a 64-bit
   file, phentsize=40, shentsize=72) and report exactly what ranges/fields are produced and
   whether the parser reads fields at fixed intra-entry offsets.
4. Report what the ehdr range covers (is it 0..e_ehsize or 0..64?) -- known: e_ehsize=65
   on a 64-byte file panics, e_ehsize=1..64 is fine, so it appears to be 0..e_ehsize.
   Confirm and report the field ranges when e_ehsize is small (e.g. 20): are the field spans
   still emitted at their fixed offsets?
5. Report all fileinfo rows for a 32-bit file to confirm identical labels.
6. Test a 32-bit big-endian file and a 64-bit big-endian file end-to-end and record the
   complete generated HTML differences vs little-endian equivalents (structural only).`,
  },
  {
    key: 'js',
    file: '/tmp/findings/js.md',
    prompt: `Determine EXACTLY the rules for the generated JavaScript call lists at the end of
elfcat's HTML output.
1. highlightClasses(...) list: in a minimal ELF it is exactly these 16 lines (in this order):
   fileinfo_class/class, fileinfo_data/data, fileinfo_abi/abi, fileinfo_abi_ver/abi_ver,
   fileinfo_e_type/e_type, fileinfo_e_machine/e_machine, fileinfo_e_entry/e_entry,
   fileinfo_e_phoff/e_phoff, fileinfo_e_shoff/e_shoff, fileinfo_e_flags/e_flags,
   fileinfo_e_ehsize/e_ehsize, fileinfo_e_phentsize/e_phentsize, fileinfo_e_phnum/e_phnum,
   fileinfo_e_shentsize/e_shentsize, fileinfo_e_shnum/e_shnum, fileinfo_e_shstrndx/e_shstrndx.
   VERIFY this list is CONSTANT (independent of the input file) by diffing across many inputs.
2. connect(...) list: determine the exact emission rule and ORDER. Observed for a gcc binary:
     connect('.e_phoff', '.bin_phdr0');
     connect('.e_shoff', '.bin_shdr0');
     then for every i: connect('.bin_phdrI > .p_offset', '.bin_segmentI');
     then for every i: connect('.bin_shdrI > .sh_offset', '.bin_sectionI');
     and interleaved with the latter: connect('.bin_shdrI > .sh_link', '.bin_shdrL') when sh_link != 0
   Determine: are the first two lines ALWAYS emitted even with phnum==0/shnum==0? (In a
   minimal 64-byte ELF with phnum=0,shnum=0 both lines WERE emitted -- confirm.)
   Is the p_offset/segment line emitted for segments with p_filesz==0, for every p_type
   (including PT_NULL)? Is the sh_offset/section line emitted for NOBITS / size-0 / NULL
   sections? Is the sh_link line's condition exactly sh_link != 0, or does it require the
   target to exist / require certain sh_types? Test sh_link out of range (>= shnum), sh_link
   pointing at itself, sh_link on a NULL section.
   Is the interleaving per-shdr (offset then link for shdr i, then shdr i+1) or two passes?
   Report the exact generated text including trailing semicolons and 6-space indentation.
3. Report the exact "let fileLen = N" line (indentation, trailing semicolon?) and confirm
   N equals the file size.
4. Diff the ENTIRE html of two different inputs and list every region that differs, to make
   sure no other part of the boilerplate is input-dependent. Report the full list of
   input-dependent regions in document order, with the exact surrounding literal text.`,
  },
  {
    key: 'errors',
    file: '/tmp/findings/errors.md',
    prompt: `Exhaustively enumerate elfcat's CLI behaviour, error messages, exit codes, and
output-file behaviour.
1. Argument parsing: test 0 args, 1 arg, 2 args, 3 args, --help, -h, --version, -v,
   -V, --, -, "" (empty string), args starting with a dash, a filename that is exactly
   "--help" existing on disk, and combinations like "--help x", "x --help", "-v -v".
   Report exact stdout/stderr text and exit codes for each. Determine whether usage goes to
   stdout or stderr (use 2>/dev/null and 1>/dev/null to separate).
   Exact usage text observed: "Usage: elfcat <filename>" newline "Writes <filename>.html to CWD."
   and version text "elfcat 0.1.10". Confirm which stream each goes to and exact newlines.
2. File read errors: nonexistent file, directory, unreadable file (chmod 000 -- note you may
   be root, in which case say so), a named pipe, /dev/null, a symlink loop, a very long path.
   Report exact messages and exit codes. The format appears to be:
   Failed to read file "ARG": <io error Display> (os error N)
3. Parse errors: enumerate every reachable "Failed to parse ELF: ..." message. Known:
   file is smaller than ELF header's e_ident; mismatched magic: not an ELF file;
   Unknown bitness: N; Unknown endianness: N; file is smaller than ELF file header.
   Find any others. Try: truncated files at every length 0..70, bad magic variants,
   bitness/endianness values, huge e_phoff/e_shoff, e_shstrndx >= e_shnum, e_phentsize=0,
   e_shentsize=0, e_phnum=0xffff, e_shnum=0xffff.
   Report the exact message text, which stream, and exit code for each.
4. Output writing: does elfcat overwrite an existing .html? What if the arg has a trailing
   slash, or is "." or ".."? What if the file has no extension vs multiple dots (does "a.b.c"
   become "a.b.c.html"?). Confirm the output path is basename(arg) + ".html" in CWD (test arg
   "/tmp/x/y.bin"). Just report observed behaviour and messages.
5. Note: a panic yields exit code 101 with
   thread 'main' (PID) panicked at src/elf/parser.rs:117:18: / index out of bounds: the len
   is L but the index is I / note: run with RUST_BACKTRACE=1 ... -- record every distinct
   panic location string (file:line:col) you can trigger and what triggers it.`,
  },
  {
    key: 'sections',
    file: '/tmp/findings/sections.md',
    prompt: `Determine EXACTLY how elfcat resolves section NAMES and the e_shstrndx handling,
plus the "Index:", "Name:", "Linked section:", "Extra info:" rows of info_shdrN.
1. info_shdrN row template observed:
     Index:, Name:, Type:, Flags:, Vaddr in memory:, Offset in file:, Size in file:,
     Linked section:, Extra info:, Alignment:, Size of entries:
   Confirm exact labels and order; note which values are wrapped in
   span class='number' title='...' and which are bare.
   From evidence: Index: bare decimal, Name: bare string, Type: bare, Flags: bare,
   Vaddr in memory: number title=decimal body=hex, Offset in file: same,
   Size in file: number title=hex body=decimal(+human), Linked section: bare decimal,
   Extra info: number title=hex body=decimal, Alignment: number title=decimal body=hex,
   Size of entries: number title=hex body=decimal. VERIFY ALL of this.
2. Section name resolution: uses e_shstrndx to find the string table. Determine behaviour when
   e_shstrndx == 0, >= e_shnum, points at a non-STRTAB section, points at a section whose
   sh_offset+sh_size exceeds EOF, sh_name >= strtab size, sh_name pointing mid-string,
   name with no terminating NUL, name containing non-UTF8 bytes, name containing HTML
   special chars < > & (is it escaped?). Report exact output (empty string? panic?
   garbage?).
3. Does e_shstrndx == SHN_XINDEX (0xffff) get special handling? Does e_shnum == 0 with
   shoff != 0 trigger extended numbering (real count in shdr[0].sh_size)? Test.
4. Determine whether section names appear anywhere else in the HTML (e.g. info_sectionN?
   span classes in #bytes? title attributes?). Report.
5. Report the complete info_sectionN template and when the STRTAB string list is included.
Include exact literal HTML fragments for each finding.`,
  },
]

phase('Probe')

const results = await parallel(TASKS.map(t => () =>
  agent(COMMON + '\n\nYOUR TASK (write findings to ' + t.file + '):\n' + t.prompt,
        { label: 'probe:' + t.key, phase: 'Probe' })
))

return results.map((r, i) => ({ key: TASKS[i].key, file: TASKS[i].file, summary: r }))
