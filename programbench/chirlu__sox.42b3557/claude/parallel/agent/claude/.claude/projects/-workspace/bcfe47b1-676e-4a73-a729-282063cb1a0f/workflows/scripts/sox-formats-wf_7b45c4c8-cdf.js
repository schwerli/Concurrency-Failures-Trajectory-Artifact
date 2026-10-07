export const meta = {
  name: 'sox-formats',
  description: 'Implement all file format handlers for the SoX reimplementation',
  phases: [ { title: 'Formats' } ],
}

const COMMON = `
You are implementing part of an original, from-scratch C re-implementation of the
command-line audio tool at /workspace/executable (self-identifies as "SoX v14.4.2").

CRITICAL RULES (violating these fails the whole project):
 - Learn behaviour ONLY by RUNNING /workspace/executable and reading the bundled
   man pages: /workspace/soxformat.7 (the authority on formats -- READ THE
   SECTIONS FOR YOUR FORMATS), /workspace/sox.1, /workspace/libsox.3, README.md.
 - NEVER search the web, fetch/clone/download upstream source, use a package
   manager to obtain the project, or read any copy of the original sources.
 - NEVER run objdump/gdb/ghidra/strace/ltrace/nm/readelf/strings on the binary.
 - Write ORIGINAL code; derive behaviour from experiments and from the manual.

Read FIRST: /workspace/notes/CONTRACT.md, /workspace/src/sox.h, /workspace/src/sox_i.h.
sox.h/sox_i.h are the fixed contract: you may ADD declarations, never change or
remove existing ones (other agents compile against them concurrently).

ONLY create/modify the files assigned to you, plus a notes file you own.
Never run 'git' write commands.

The project does not link yet, so you CANNOT run an end-to-end comparison.
Therefore: probe the reference exhaustively, record the observed BYTES, work out
the layout, implement, and compile-check every file:
    cc -c -std=gnu99 -I/workspace/src -O2 -Wall /workspace/src/FILE.c -o /tmp/o.o
Iterate until clean.

HOW TO GET GROUND TRUTH
  # a deterministic mono/stereo source
  /workspace/executable -n -r 8000 -c 1 -b 16 /tmp/a.wav synth 0.01 sin 300
  # write your format and dump every byte
  /workspace/executable -D /tmp/a.wav /tmp/out.EXT && od -Ad -tx1z /tmp/out.EXT
  # read it back and confirm what the reference thinks it is
  /workspace/executable -V4 --i /tmp/out.EXT
  # round-trip the samples to text to check the codec
  /workspace/executable -D /tmp/out.EXT -t dat -
Vary channels, rates, encodings (-e/-b), lengths (including odd lengths that
need padding), and comments (--comment / --add-comment) so you see every header
field change. Also test writing to a PIPE ('-t EXT -' redirected to a file) --
non-seekable output usually changes what the writer can patch up afterwards, and
the reference may warn; reproduce that.
Test reading: hand-craft files with python3 to check the reader's tolerance and
error messages, e.g. truncated files, unknown chunks, wrong sizes.

FORMAT MODULE CONVENTIONS
 - One file per module: /workspace/src/fmt_<mod>.c exporting exactly
       sox_format_handler_t const *lsx_<mod>_format_fn(void);
   (the module list is /workspace/src/formats.h -- names are already fixed there)
 - Put '#define LSX_MODULE_NAME "<mod>"' at the very top before including
   "sox_i.h" so diagnostics read 'PROG WARN <mod>: ...'. Check the reference's
   actual subsystem name in its messages and match it.
 - handler.names lists the primary name first then aliases; handler.flags uses
   SOX_FILE_*; write_formats is a 0-terminated list of
   {encoding, bits..., 0, encoding, bits..., 0, 0} groups whose ORDER must match
   './executable --help-format <mod>' exactly. write_rates is a 0-terminated
   list of allowed rates or NULL.
 - Use the lsx_read*/lsx_write* helpers for endian-aware I/O and
   lsx_rawread/lsx_rawwrite for plain sample coding (declared in sox_i.h;
   another agent implements them).
 - Set ft->signal.rate/channels/length and ft->encoding.encoding/bits_per_sample
   in startread; set ft->signal.precision only if it is not derivable via
   lsx_precision().

Final message: a SHORT report (< 35 lines): which formats you implemented,
key layout facts, what remains uncertain, header additions.
`;

phase('Formats')

const groups = [
  {
    label: 'wav',
    files: 'fmt_wav.c adpcm.c ima_rw.c',
    prompt: `Implement src/fmt_wav.c (the 'wav' handler, also named 'wavpcm' and
'amb'), plus shared ADPCM helpers in src/adpcm.c and src/ima_rw.c (declare their
interfaces in sox_i.h).

Reference facts to reproduce (verify all of them):
 - './executable --help-format wav' says:
     Description: Microsoft audio format ; Also handles: wavpcm amb
     Writes: 16/24/32-bit Signed Integer PCM, 8-bit Unsigned Integer PCM,
             8-bit u-law, 8-bit A-law, 4-bit MS ADPCM, 4-bit IMA ADPCM,
             32/64-bit Floating Point PCM   (in exactly that order)
 - A minimal 8000 Hz mono 16-bit write produces exactly:
     "RIFF" <size> "WAVE" "fmt " 16 <PCM=1> <ch> <rate> <byterate> <align>
     <bits> "data" <size> <samples...>
   (verified). Determine when the writer emits a 18-byte or 40-byte fmt chunk
   (WAVE_FORMAT_EXTENSIBLE), a 'fact' chunk, and the extra fields for the ADPCM
   encodings, plus padding of odd-sized chunks.
 - The 'amb' name selects B-format ambisonic WAV: determine what differs.
 - 'wavpcm' forces plain PCM: determine what differs.
 - RIFX (big-endian RIFF) must be READ (the reference lists no separate handler
   but 'soxformat.7' mentions it -- check by hand-crafting a RIFX file).
 - Reading: handle unknown chunks, LIST/INFO comments (write them too if the
   reference does -- check with --comment), 'fact' sample counts, cue points,
   and the --ignore-length option.
 - MS ADPCM and IMA ADPCM must be bit-exact both ways. Derive the codecs from
   round-trips: write a known ramp/sine to '-e ms-adpcm' and '-e ima-adpcm',
   dump the bytes, then read them back to -t dat. The block size chosen by the
   writer for a given rate/channels is observable in the fmt chunk; reproduce it.
 - GSM: the reference accepts '-e gsm-full-rate' per its -h text. Check whether
   'wav' can actually write it ('./executable a.wav -e gsm-full-rate out.wav');
   if it fails, reproduce the failure; if it works, implement GSM 06.10 -- report
   which.
Write findings to /workspace/notes/fmt_wav.md.`,
  },
  {
    label: 'aiff-au',
    files: 'fmt_aiff.c fmt_aifc.c fmt_au.c fmt_sf.c',
    prompt: `Implement src/fmt_aiff.c ('aiff', alias 'aif'), src/fmt_aifc.c
('aifc', alias 'aiffc'), src/fmt_au.c ('au', alias 'snd') and src/fmt_sf.c
('sf', alias 'ircam'). Put any shared AIFF chunk code in fmt_aiff.c and declare
it in sox_i.h.

Verified starting points:
 - A minimal 8000 Hz mono 16-bit 11-sample AIFF write is exactly:
   "FORM" 00000066 "AIFF" "COMT" 0000001a 0001 <4-byte timestamp> 0000 0010
   "Processed by SoX" "COMM" 00000012 0001 0000000b 0010 <10-byte 80-bit float
   rate = 400bfa00000000000000 for 8000> "SSND" 0000001e 00000000 00000000
   <samples big-endian>
   NOTE the COMT timestamp is seconds since 1904-01-01 (i.e. unix time +
   2082844800) so AIFF output is NOT reproducible; implement the same field.
 - AU: "\\x2esnd" <hdr size=24+comment padded to a multiple of 8> <data size>
   <encoding code> <rate> <channels> <comment padded with NULs>. Verified for
   16-bit: encoding code 3, header size 0x2c with the 16-byte default comment.
   Determine every encoding code (u-law=1, 8-bit=2, 16-bit=3, 24-bit=4,
   32-bit=5, float32=6, float64=7, A-law=27 -- VERIFY each by writing with -e).
   Also handle the "dot-snd" variant with unknown length (0xffffffff) and
   little-endian AU ('.snd' reversed magic) on read.
 - AIFC additionally writes an "FVER" chunk and a compression type in COMM
   ('NONE', 'fl32', 'fl64', 'sowt', ...). Determine exactly which and in what
   order, and which compression types can be READ.
 - IRCAM/sf: determine the header (magic variants for both endiannesses, rate,
   channels, encoding code, and the 'sf' comment/codes area).
For all four: determine what happens with a non-seekable output (pipe), how the
length field is patched, and the marker/instrument/loop chunks (MARK/INST) which
the reference reads and writes for AIFF -- check with a file that has loops (you
can only produce one via smp or aiff round trip; investigate).
Write findings to /workspace/notes/fmt_aiff.md.`,
  },
  {
    label: 'misc1',
    files: 'fmt_voc.c fmt_smp.c fmt_maud.c fmt_avr.c fmt_svx.c fmt_htk.c fmt_sndrtool.c fmt_sndtool.c',
    prompt: `Implement: voc, smp, maud, avr, svx (the '8svx' handler), htk,
sndrtool (the 'sndr' handler), sndtool (the 'sndt' handler).

From './executable --help-format=all':
  voc  "Creative Technology Sound Blaster format", mono/stereo,
       writes 16-bit Signed Integer PCM then 8-bit Unsigned Integer PCM
  smp  "Turtle Beach SampleVision", mono, writes 16-bit signed
  maud "Used with the 'Toccata' sound-card on the Amiga", mono/stereo,
       writes 16-bit signed, 8-bit unsigned, 8-bit u-law, 8-bit A-law
  avr  "Audio Visual Research format; used on the Mac", mono/stereo,
       writes 16-bit signed, 8-bit signed, 16-bit unsigned, 8-bit unsigned
  8svx "Amiga audio format (a subformat of the Interchange File Format)",
       mono/stereo/quad, writes 8-bit signed
  htk  "PCM format used for Hidden Markov Model speech processing", mono,
       writes 16-bit signed
  sndr "8-bit linear audio as used by Aaron Wallace's 'Sounder' of 1991", mono,
       writes 8-bit unsigned
  sndt "8-bit linear audio as used by Martin Hepperle's 'SoundTool' of 1991/2",
       mono, writes 8-bit unsigned
Reproduce each description and the write_formats order exactly.

Dump every header byte for each format at several rates/channels/lengths and
work out every field (including the VOC block structure with its block types,
silence blocks, extended blocks and terminator; the 8SVX FORM/VHDR/ANNO/BODY
chunks; SampleVision's text header, markers and loops; MAUD's FORM/MHDR/MDAT;
AVR's fixed-size header with its name field; HTK's simple header with its
parameter kind; Sounder/SoundTool's small headers).
Also determine which are magic-detected on read.
Write findings to /workspace/notes/fmt_misc1.md.`,
  },
  {
    label: 'misc2',
    files: 'fmt_sphere.c fmt_prc.c fmt_txw.c fmt_wve.c fmt_gsrt.c fmt_xa.c fmt_hcom.c',
    prompt: `Implement: sphere (the 'sph' handler, alias 'nist'), prc, txw, wve,
gsrt, xa, hcom.

From './executable --help-format=all':
  sph  "SPeech HEader Resources; defined by NIST", also 'nist';
       writes 8/16/24/32-bit signed and 8-bit u-law
  prc  "Psion Record; used in EPOC devices (Series 5, Revo and similar)",
       mono, 8000 Hz, writes 8-bit A-law then 4-bit IMA ADPCM
  txw  "Yamaha TX-16W sampler", mono, rates 16666.7/33333.3/50000,
       writes 12-bit signed
  wve  "Psion 3 audio format", mono, 8000 Hz, writes 8-bit A-law
  gsrt "Grandstream ring tone", mono, 8000 Hz, writes 8-bit A-law then u-law
  xa   "16-bit ADPCM audio files used by Maxis games", Reads: yes, Writes: no
  hcom "Mac FSSD files with Huffman compression", mono,
       rates 22050/11025/7350/5512.5, writes 8-bit HCOM
Reproduce each description and write_formats order exactly.

sphere's header is ASCII ('NIST_1A\\n   1024\\n' then 'key -type value' lines
then padding to 1024) -- dump it and reproduce every line, in order, including
the sample_count/sample_rate/channel_count/sample_n_bytes/sample_byte_format/
sample_coding fields and 'end_head'. Check what it does for a non-seekable
output.
hcom is Huffman-compressed: derive the exact bit-stream and the writer's
Huffman tree construction from round-trips on several inputs (this one is hard;
if you cannot make the writer bit-identical, make it produce a file the
reference can read back correctly, and SAY SO in your report).
xa is read-only ADPCM: derive the decoder from files you cannot create... you
cannot create them with the reference, so hand-craft one from the format
description in /workspace/soxformat.7 and verify the reference decodes it the
way your decoder does.
txw's 12-bit packing, prc's Psion header and its ADPCM variant, wve's
'ALawSoundFile**' header, gsrt's tiny header: dump and reproduce.
Write findings to /workspace/notes/fmt_misc2.md.`,
  },
  {
    label: 'text-native',
    files: 'fmt_dat.c fmt_sox.c fmt_nul.c fmt_oss.c fmt_lpc10.c fmt_vox.c fmt_ima.c',
    prompt: `Implement: dat, sox (the native intermediate format), nul (the
'null' handler), oss (the 'ossdsp' device driver, alias 'oss'), lpc10, vox, ima.

  dat  "Textual representation of the sampled audio", writes
       "Floating Point (text) PCM (54-bit precision)".
       VERIFIED: it uses CRLF line endings and starts
         "; Sample Rate 8000\\r\\n; Channels 1\\r\\n"
       then one line per frame. Determine the EXACT column layout with od -c:
       the observed start of a data line is 15 or 16 columns of time then the
       channel values. Reproduce byte-for-byte, including the trailing space
       before the CRLF, for 1..4 channels and several rates. Also implement
       READING .dat (it must accept its own output and tolerate comments,
       arbitrary whitespace and missing rate/channel headers -- test).
  sox  "SoX native intermediate format", writes 32-bit signed.
       VERIFIED header for 11 samples, 8000 Hz, mono, comment "Processed by SoX":
         2e 53 6f 58 | 2c 00 00 00 | 0b 00 00 00 00 00 00 00 |
         <double rate 8000 = 00 00 00 00 00 40 bf 40> | 01 00 00 00 |
         10 00 00 00 | "Processed by SoX"     and data starts at offset 48.
       So: 4-byte magic ".SoX", 4-byte header-size (48-4=44), 8-byte sample
       count, 8-byte double rate, 4-byte channels, 4-byte comment length,
       comment. VERIFY the padding/alignment rule by writing comments of many
       lengths (0,1,3,4,5,15,16,17) and re-reading. Also determine the
       big-endian variant magic ("XoS." ?) and unknown-length handling.
  nul  the 'null' handler: PHONY, no file. Reading yields silence forever;
       writing discards. Its info block shows
         "Input File     : '' (null)" with Channels 1, Sample Rate 48000,
         Precision 32-bit. Determine its defaults exactly.
  oss  the OSS device driver ('ossdsp', alias 'oss'), writes 32/16-bit signed
       and 8-bit unsigned. There is no /dev/dsp in this environment; determine
       the exact failure message the reference gives for
       './executable a.wav -t ossdsp /dev/dsp' and 'rec'/'play' and reproduce
       it. Implement real OSS ioctls behind #ifdef but make the no-device path
       byte-identical.
  lpc10 "Low bandwidth, robotic sounding speech compression", mono, 8000 Hz,
       writes "LPC10 (16-bit precision)". This is the LPC-10e voice codec.
       Implement as much as you can; a full LPC-10 analyser/synthesiser is
       large, so if you cannot, make the handler present (so the format list and
       --help-format output are right) and fail cleanly on use -- but FIRST
       check what the reference actually produces so you know what you are
       missing, and report honestly.
  vox  "Raw OKI/Dialogic ADPCM", mono, writes 4-bit OKI ADPCM (12-bit precision)
  ima  "Raw IMA ADPCM", mono, writes 4-bit IMA ADPCM (13-bit precision)
       Both are headerless ADPCM; derive the codecs bit-exactly from round trips
       (write a known ramp, dump bytes, read back to -t dat). Coordinate with the
       'wav' agent who is writing src/adpcm.c and src/ima_rw.c -- if those files
       exist use them, otherwise implement the codec locally in your files and
       note it.
Write findings to /workspace/notes/fmt_text.md.`,
  },
  {
    label: 'cvsd',
    files: 'fmt_cvsd.c fmt_cvu.c fmt_dvms.c',
    prompt: `Implement: cvsd, cvu, dvms.

  cvsd "Headerless MIL Std 188 113 Continuously Variable Slope Delta
        modulation", also 'cvs', mono, writes "1-bit CVSD (16-bit precision)"
  cvu  "Headerless Continuously Variable Slope Delta modulation (unfiltered)",
        mono, writes 1-bit CVSD
  dvms "MIL Std 188 113 Continuously Variable Slope Delta modulation with
        header", also 'vms', mono, writes 1-bit CVSD

CVSD is a 1-bit delta modulator with an adaptive step size and a low-pass
reconstruction filter. Derive the exact algorithm from round-trips:
  # a slow ramp and a sine, written to cvsd and dumped as bits
  /workspace/executable -D -t s32 -r 8000 -c 1 /tmp/ramp.s32 -t cvsd - | od -An -tx1
  # and decoded back
  /workspace/executable -D -t cvsd -r 8000 /tmp/x.cvsd -t dat -
Determine: the bit packing order within a byte, the run-length window used for
slope detection (typically 4 bits), the step-size adaptation constants (beta /
time constants, which depend on the sample rate), and the filter applied on
decode (cvu skips it). The reference's -V3/-V4 output may print the derived
constants -- capture it.
dvms adds a 512-byte header; dump and reproduce every field (it contains a
checksum -- work out how it is computed) and determine the read tolerance.
Write findings to /workspace/notes/fmt_cvsd.md.`,
  },
]

const results = await parallel(groups.map(g => () =>
  agent(COMMON + '\n\nYOUR ASSIGNMENT. Create these files under /workspace/src/ (and only these): '
        + g.files + '\n\n' + g.prompt,
        { label: g.label, phase: 'Formats' })
))

return results.map((r, i) => ({ group: groups[i].label, report: r }))
