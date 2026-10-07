export const meta = {
  name: 'sox-core-phase1',
  description: 'Implement the core libSoX-equivalent infrastructure for the SoX reimplementation',
  phases: [
    { title: 'Core' },
  ],
}

const COMMON = `
You are implementing part of an original, from-scratch C re-implementation of the
command-line audio tool found at /workspace/executable (it self-identifies as
"SoX v14.4.2").

CRITICAL RULES (violating these fails the whole project):
 - You may ONLY learn behaviour by RUNNING /workspace/executable and reading the
   bundled man pages /workspace/sox.1, /workspace/soxformat.7, /workspace/libsox.3,
   /workspace/README.md.
 - You MUST NOT search the web, fetch/clone/download any upstream source, use any
   package manager to obtain the project, or read any copy of the original sources.
 - You MUST NOT run objdump/gdb/ghidra/strace/ltrace/nm/readelf/strings on
   /workspace/executable.
 - Write ORIGINAL code. Do not reproduce upstream source you may remember verbatim;
   derive behaviour from experiments.

Read /workspace/notes/CONTRACT.md, /workspace/src/sox.h and /workspace/src/sox_i.h
FIRST. They are the fixed contract: do not change sox.h or sox_i.h except to ADD
declarations you need (never remove or change existing ones; other agents are
compiling against them concurrently).

ONLY create/modify the files explicitly assigned to you. Other agents are editing
other files in the same tree at the same time. Never run 'git' write commands.

You cannot get a clean whole-project link yet (many modules are stubs). To check
your own file compiles, use:
    cc -c -std=gnu99 -I/workspace/src -O2 -Wall /workspace/src/YOURFILE.c -o /tmp/$$.o
Iterate until it compiles with no errors.

Your final message must be a SHORT report (< 30 lines): what you implemented,
any behaviour you could not determine, and any additions you made to the headers.
`;

phase('Core')

const tasks = [
  {
    label: 'util',
    files: 'src/util.c',
    prompt: `Implement /workspace/src/util.c providing these functions declared in sox_i.h:

memory: lsx_malloc, lsx_calloc, lsx_realloc, lsx_strdup (die with a message on OOM),
  lsx_realloc_array_impl.
strings: lsx_strcasecmp, lsx_strncasecmp, lsx_strends, lsx_find_file_extension,
  lsx_strchr.
messaging: sox_output_message, lsx_fail_impl, lsx_warn_impl, lsx_report_impl,
  lsx_debug_impl, lsx_debug_more_impl, lsx_debug_most_impl, and the globals
  sox_globals / sox_effects_globals / lsx_macro_temp_sample / lsx_macro_temp_double /
  lsx_ranqd1_state, sox_version(), sox_strerror(), lsx_ranqd1(), lsx_seed_prng().
option parsing: lsx_getopt_init, lsx_getopt (a getopt_long-like scanner over an
  argv slice; supports "+"-prefixed shortopts meaning stop at first non-option,
  ':' for required arg, "::" optional arg; long options matched by unique prefix;
  on error with lsx_getopt_flag_opterr set, print a message like the reference does).
number/time parsing: lsx_parsesamples, lsx_parseposition, lsx_parse_frequency,
  lsx_parse_frequency_k, lsx_parse_note, lsx_parse_width.
comments: lsx_append_comment, lsx_append_comments, lsx_copy_comments,
  lsx_delete_comments, lsx_find_comment, lsx_num_comments, lsx_cat_comments.
misc: lsx_precision, lsx_sigfigs3, lsx_sigfigs3p, lsx_usage, lsx_usage_lines.

DETAILS YOU MUST DETERMINE BY EXPERIMENT with /workspace/executable:

1. Message format. Determine exactly, e.g.
     /workspace/executable FAIL formats: xyz
     /workspace/executable WARN dither: dither clipped 2 samples; decrease volume?
     /workspace/executable INFO sox: effects chain: ...
     /workspace/executable DBUG sox: start-up time = 0.000189
   The token after the level is the "subsystem" (set by the lsx_* macros from
   __FILE__ with directory and .c extension stripped). Verbosity gates: 1=FAIL,
   2=WARN, 3=INFO(report), 4=DBUG, 5=DBUG(more), 6=DBUG(most). Note the exact
   spacing/format ("%s %-5s %s: " or similar -- determine it!). Level 1 messages
   are prefixed FAIL. Also determine how "-V" with no number increments the level.
   Try e.g.:  ./executable -V3 nosuchfile.wav out.wav ; ./executable -V1 ... etc.
   Also note that when the message is emitted for a failing file the reference
   sometimes prints "FAIL formats: can't open input file \`x': No such file or directory".
   Just make the primitive faithful; other modules supply the text.

2. lsx_precision(encoding, bits): returns the sample precision reported by the
   reference. Verify against './executable --help-format=all' which prints e.g.
   "32-bit Floating Point PCM (25-bit precision)", "8-bit u-law (14-bit precision)",
   "8-bit A-law (13-bit precision)", "4-bit MS ADPCM (14-bit precision)",
   "4-bit IMA ADPCM (13-bit precision)", "4-bit OKI ADPCM (12-bit precision)",
   "1-bit CVSD (16-bit precision)", "8-bit HCOM (8-bit precision)",
   "LPC10 (16-bit precision)", "Floating Point (text) PCM (54-bit precision)",
   "64-bit Floating Point PCM (54-bit precision)".
   Also fill in the table 'sox_encodings_info' (declared in sox.h): for each
   sox_encoding_t give {name, desc, flags}. 'name' is the short lower-case name
   accepted by -e / printed by 'soxi -e'... actually determine: 'soxi -e' prints
   "Signed Integer PCM"; '-e' accepts "signed-integer", "unsigned-integer",
   "floating-point", "mu-law", "a-law", "ima-adpcm", "ms-adpcm", "gsm-full-rate"
   (see ./executable -h). Provide BOTH: put the human-readable description in
   'desc' and the option name in 'name'. Determine the full set of -e names the
   reference accepts by trying them (e.g. './executable -n -e oki-adpcm -t raw f'
   and see which are rejected). Use flags to mark encodings that have no
   bits-per-sample prefix in the display (FLOAT_TEXT, LPC10, GSM, MP3, VORBIS...).

3. lsx_sigfigs3(uint64) / lsx_sigfigs3p(double): these produce the "3 significant
   figures" strings used in the file info display: e.g. File Size "176k", Bit Rate
   "1.41M", "128k", "535k", and CDDA sector counts. Determine the exact algorithm
   by feeding files of many sizes to './executable --i' and comparing. Hints:
   values < 1000 print as the integer; then 'k', 'M', 'G'; 3 significant figures
   with the decimal point placed accordingly ("1.41M", "176k", "12.3k", "999",
   "1.00k"). VERIFY with many sizes. lsx_sigfigs3p formats percentages such as
   the "In:12.3%" of the progress meter.

4. lsx_parsesamples(rate, str, &samples, def): parses "1.5" (seconds),
   "1:30" / "1:30.5" (mm:ss), "1:02:03.4" (hh:mm:ss), "8000s" (samples),
   "3t" (?), "0.5e" ... Determine exactly which suffixes are accepted and how
   rounding is done, using the trim/pad/fade effects with -V3 and by measuring
   the resulting sample counts. 'def' is 't' (time) or 's' (samples) and selects
   the default interpretation when no suffix is given. Returns pointer to the
   first unparsed char, or NULL on failure.
   lsx_parseposition additionally handles leading '=', '+' and '-' (absolute /
   relative to latest / relative to end) as used by the trim effect; determine
   the semantics from 'man sox' (/workspace/sox.1, the trim section) and testing.

5. lsx_parse_frequency_k / lsx_parse_frequency: parses a frequency, accepting a
   trailing 'k' multiplier (x1000) and a leading '%' or a note name for
   equal-tempered note notation (see the synth section of sox.1). key argument:
   when >= 0 the value may be a note number relative to that key.
   lsx_parse_note handles the "%" note syntax used by 'synth sin %-12'.

6. lsx_parse_width(str, &end, &type): parses widths like "100", "0.5s", "2q",
   "3o", "200h", "1k" returning the value and the width type
   (lsx_bw_width_Q/bw_Hz/bw_kHz/bw_oct/slope). See the biquad-filter effects in
   sox.1.

7. lsx_seed_prng()/lsx_ranqd1_state: the reference uses a linear congruential
   generator x = 1664525*x + 1013904223. With the global option -R the seed is
   fixed so runs are identical. Determine the fixed seed by experiment: run
   './executable -R -D -t s16 -r 8000 -c 1 IN -t s8 -' where IN has known samples
   and the automatic 'dither' effect is active, and solve for the seed. Ask
   yourself what dither does (TPDF: adds (ranqd1()>>N + ranqd1()>>N) scaled).
   Record what you find in /workspace/notes/prng.md (you may create that file).
   If you cannot pin it down, implement seed = 0 and say so in your report.

8. lsx_usage(effp): prints the effect usage to stderr and returns SOX_EOF.
   Determine the exact text, e.g. run './executable -n -t raw - vol' with a bad
   argument and see:
     'sox FAIL vol: usage: vol GAIN [TYPE [LIMITERGAIN]]' or similar.

Create /workspace/notes/util.md summarising what you determined (formats of
messages, sigfigs algorithm, parsesamples grammar) so other agents can rely on it.`,
  },
  {
    label: 'formats_i',
    files: 'src/formats_i.c',
    prompt: `Implement /workspace/src/formats_i.c: the low-level file I/O helpers declared
in sox_i.h (everything from lsx_readbuf down to lsx_check_read_params).

 - lsx_readbuf/lsx_writebuf wrap fread/fwrite on ft->fp, and must set ft->eof.
 - lsx_readw/readdw/read3/readqw/readf/readdf and the write counterparts must
   honour ft->encoding.reverse_bytes (SOX_OPTION_YES means swap relative to the
   host, which is little-endian on this platform). read3/write3 handle 24-bit.
 - the *_buf variants read/write arrays efficiently, returning the count of
   items transferred.
 - lsx_readf reads a 32-bit IEEE float, lsx_readdf a 64-bit double.
 - lsx_reads reads a NUL- or newline-terminated string of at most len chars;
   lsx_writes writes a string without its NUL. lsx_readchars reads exactly len
   bytes. Determine exact behaviour by looking at which formats use them.
 - lsx_skipbytes: skip forward, using fseek when seekable else reading.
 - lsx_padbytes: write n zero bytes.
 - lsx_seeki/lsx_tell/lsx_rewind/lsx_clearerr/lsx_eof/lsx_error/lsx_flush:
   thin wrappers; lsx_seeki must fail gracefully for non-seekable streams and
   set ft->sox_errno/sox_errstr.
 - lsx_unreadb: push a byte back (ungetc).
 - lsx_filelength: size in bytes of ft->fp, 0 if not a regular file.
 - lsx_offset_seek(ft, byte_offset, to_sample): seek to
   byte_offset + to_sample/channels * bytes_per_sample-ish; used by raw-based
   formats to implement seeking. Work out the arithmetic that makes
   'trim' + '-t s16' seeking correct.
 - lsx_read_fields(ft, &n, spec, ...): a scanf-like reader used by textual
   headers. Determine a reasonable design; it is only used by modules you and
   others write, so keep it simple: it reads whitespace-separated fields
   according to a printf-style spec.
 - lsx_check_read_params(ft, channels, rate, encoding, bits_per_sample,
   num_samples, check_length): compares header values against any user-supplied
   overrides in ft->signal/ft->encoding and emits the reference's warnings.
   Determine the exact warning text by experiment, e.g.
     ./executable -r 9000 -c 3 file.wav out.wav
   should warn about overriding. Try several combinations (rate, channels,
   encoding, bits) and record the exact wording. Then implement.

Create /workspace/notes/formats_i.md documenting the override-warning texts.`,
  },
  {
    label: 'xlaw',
    files: 'src/xlaw.c',
    prompt: `Implement /workspace/src/xlaw.c: the u-law and A-law codecs declared in sox_i.h
(lsx_14linear2ulaw, lsx_ulaw2linear16, lsx_13linear2alaw, lsx_alaw2linear16,
lsx_ulaw2linear_table[256], lsx_alaw2linear_table[256], lsx_ulaw_inittabs,
lsx_alaw_inittabs, lsx_ulaw_to_alaw_table, lsx_alaw_to_ulaw_table).

These MUST be bit-exact. Derive the tables by experiment:

  # decode: every u-law code -> 32-bit sample
  python3 -c "import sys;sys.stdout.buffer.write(bytes(range(256)))" > /tmp/ul.raw
  /workspace/executable -t ul -r 8000 -c 1 /tmp/ul.raw -t s32 - | od -An -td4
  # and the same with -t al
  # encode: sweep 16-bit values -> u-law / A-law
  python3 -c "
import struct,sys
sys.stdout.buffer.write(b''.join(struct.pack('<h',v) for v in range(-32768,32768)))" > /tmp/sw.raw
  /workspace/executable -D -t s16 -r 8000 -c 1 /tmp/sw.raw -t ul - | od -An -tu1

From the encode sweep, work out the standard G.711 algorithm with the exact
bias/clip/segment behaviour the reference uses (note the names:
"14linear2ulaw" takes a 14-bit-scaled value, "13linear2alaw" a 13-bit one --
figure out the scaling the raw writer applies before calling them, i.e. how a
32-bit sox sample maps to the argument). Verify your implementation reproduces
the full 65536-entry sweep exactly by writing a small standalone test program.

lsx_ulaw_to_alaw_table / lsx_alaw_to_ulaw_table are 256-entry cross-conversion
tables allocated and filled by the inittabs functions (test with
'-t ul in -t al out' round trips).

Report the exact algorithm you derived and confirm the sweep matches 65536/65536.`,
  },
  {
    label: 'raw',
    files: 'src/fmt_raw.c src/fmt_s1.c src/fmt_s2.c src/fmt_s3.c src/fmt_s4.c src/fmt_u1.c src/fmt_u2.c src/fmt_u3.c src/fmt_u4.c src/fmt_al.c src/fmt_la.c src/fmt_lu.c src/fmt_ul.c src/fmt_f4.c src/fmt_f8.c src/fmt_sln.c src/fmt_cdr.c',
    prompt: `Implement the raw sample codec and the headerless format modules:
  src/fmt_raw.c  -- lsx_raw_format_fn plus the shared lsx_rawread / lsx_rawwrite /
                    lsx_rawstartread / lsx_rawstartwrite / lsx_rawstopread /
                    lsx_rawstopwrite / lsx_rawseek functions declared in sox_i.h.
  src/fmt_s1.c s2 s3 s4 u1 u2 u3 u4 al la lu ul f4 f8 sln cdr -- thin wrappers
                    that fix the encoding/bits (and for some, rate/channels).

Aliases and restrictions (from './workspace/executable --help-format=all'):
  raw  "Raw PCM, mu-law, or A-law"                     (no fixed encoding)
  s1   also s8 sb   : 8-bit signed         s2 also s16 sw : 16-bit signed
  s3   also s24     : 24-bit signed        s4 also s32 sl : 32-bit signed
  u1   also u8 ub sou fssd : 8-bit unsigned  u2 also u16 uw : 16-bit unsigned
  u3   also u24     : 24-bit unsigned      u4 also u32 : 32-bit unsigned
  al                : 8-bit A-law          la : 8-bit A-law
  ul                : 8-bit u-law          lu : 8-bit u-law
  f4   also f32     : 32-bit float         f8 also f64 : 64-bit float
  sln  "Asterisk PBX headerless format" mono, 8000 Hz, 16-bit signed
  cdr  also cdda / "cdda" primary? -- CHECK: the reference lists format "cdda"
       with alias "cdr", "Red Book Compact Disc Digital Audio", stereo, 44100,
       16-bit signed, big-endian? DETERMINE the endianness by experiment.
  Note al/la and ul/lu differ in their default byte order handling for the
  underlying nothing (they are 8-bit) -- but 'la'/'lu' vs 'al'/'ul' DO differ:
  determine how by experiment (hint: try '-t la' vs '-t al' on the same data;
  also compare './executable --help-format la' and 'al' descriptions).

Sample coding, which must be bit exact (verify all of these!):
  signed 8/16/24/32, unsigned 8/16/24/32, float 32/64, u-law, A-law.
  The conversion macros are already in sox.h (SOX_SAMPLE_TO_SIGNED etc.); use
  them and verify with:
    printf ... > /tmp/in.s16
    /workspace/executable -D -t s16 -r 8000 -c 1 /tmp/in.s16 -t <TYPE> - | od ...
  Also handle:
   * -N/--reverse-nibbles and -X/--reverse-bits (ft->encoding.reverse_nibbles /
     reverse_bits) for 8-bit and 4-bit encodings -- determine exact semantics.
   * clip counting into ft->clips (the driver reports
     "\`FILE' output clipped N samples; decrease volume?").
   * 4-bit encodings are NOT handled here (separate modules).
  lsx_rawstartread must set up ft->signal.length from the file size when known:
  './executable --i' on a raw file reports a Duration, so derive
  length = filesize*8/bits (rounded how? determine with odd file sizes).

Also implement lsx_rawseek and lsx_offset_seek's raw counterpart usage so that
'trim' works on raw input.

Report the endianness defaults you determined for each module and anything
uncertain.`,
  },
  {
    label: 'dsp',
    files: 'src/dsp.c src/fft4g.c',
    prompt: `Implement /workspace/src/fft4g.c (a self-contained split-radix real/complex FFT)
and /workspace/src/dsp.c providing the DSP helpers declared in sox_i.h:
  lsx_safe_rdft, lsx_safe_cdft, lsx_bessel_I_0,
  lsx_apply_hann, lsx_apply_hann_f, lsx_apply_hamming, lsx_apply_bartlett,
  lsx_apply_blackman, lsx_apply_blackman_nutall, lsx_apply_kaiser,
  lsx_kaiser_beta, lsx_kaiser_params, lsx_design_lpf, lsx_fir_to_phase,
  lsx_make_lpf, lsx_zero_phase.

These are the building blocks used by the 'rate', 'sinc', 'hilbert', 'noisered',
'stats', 'dither' and 'fir' effects, so they need to be numerically accurate; the
exact upstream implementation cannot be observed directly, so implement textbook
versions carefully and document conventions:

 - lsx_safe_rdft(len, type, d): real DFT of len (power of 2) samples in place.
   type=+1 forward, -1 inverse. Use the common convention where the output is
   packed as d[0]=Re(0), d[1]=Re(len/2), then Re(k),Im(k) pairs for k=1..len/2-1,
   and the inverse is scaled by 2/len. Document your convention in a comment;
   other agents must use the same one, so ALSO write it to
   /workspace/notes/dsp.md.
 - lsx_apply_hann(h,n): multiply h[0..n-1] by a Hann window
   (0.5 - 0.5*cos(2*pi*i/(n-1))).
 - lsx_kaiser_beta(att, tr_bw), lsx_kaiser_params(att, tr_bw, &beta, &num_taps):
   the standard Kaiser window design formulas (att in dB, tr_bw as a fraction of
   the sample rate).
 - lsx_make_lpf(num_taps, Fc, beta, rho, scale, dc_norm): windowed-sinc low-pass
   with cut-off Fc (normalised 0..1 where 1 = Nyquist), Kaiser window beta,
   optional dc normalisation. 'rho' is a Kaiser-window shape tweak; if you cannot
   determine its purpose, treat it as a multiplier on the window argument and
   document that.
 - lsx_design_lpf(Fp, Fc, Fn, allow_aliasing, att, &num_taps, k): design a
   low-pass with pass-band edge Fp, cut-off Fc, Nyquist Fn; if *num_taps is 0 on
   entry, choose the number of taps (rounded up to a multiple of k when k>0).
 - lsx_fir_to_phase(&h, &len, &post_len, phase): convert a linear-phase FIR to
   the requested phase response (0=minimum, 50=linear, 100=maximum) via the
   real cepstrum / minimum-phase reconstruction; sets *post_len to the number of
   post-peak taps.
 - lsx_zero_phase(in, len, out): produce the zero-phase (peak-at-0) arrangement.

Write a small standalone test in /tmp to check the FFT round-trips and that the
designed filters have the expected magnitude response. You can sanity-check
against the reference indirectly: '/workspace/executable --plot gnuplot -n -n
sinc 1000' prints the filter coefficients/response as a gnuplot script -- use
that to validate lsx_design_lpf/lsx_make_lpf numerically! Do the same with
'--plot octave'. Report how close you got.`,
  },
  {
    label: 'effects-engine',
    files: 'src/effects.c src/effects_i.c',
    prompt: `Implement /workspace/src/effects.c (the effects chain engine) and
/workspace/src/effects_i.c (small shared helpers for effects).

effects.c must provide, per sox.h: sox_find_effect, sox_create_effect,
sox_effect_options, sox_create_effects_chain, sox_delete_effects_chain,
sox_add_effect, sox_flow_effects, sox_effects_clips, sox_stop_effect,
sox_push_effect_last, sox_pop_effect_last, sox_delete_effect, sox_delete_effects,
lsx_report_effect_chain, plus the effect registry table built from
src/effects.h (skip modules whose lsx_*_effect_fn returns NULL for now).

Engine semantics (from /workspace/libsox.3 "EFFECTS" and observation):
 - sox_add_effect(chain, effp, in, out): if the handler lacks SOX_EFF_MCHAN,
   create in->channels parallel "flows" of the effect, each with its own priv
   copy, and each sees de-interleaved single-channel data; the engine
   interleaves/de-interleaves around them. effp->flows and effp->flow are set.
 - Effects declare rate/channel changes via effp->out_signal (set in getopts or
   start). in is updated to the effect's actual output signal so it can be
   passed to the next sox_add_effect.
 - Each effect gets an output buffer of sox_globals.bufsiz samples; run the
   chain by pulling: repeatedly try to flow data through, and once the source is
   exhausted call drain() on each effect in turn until all are done.
 - sox_flow_effects invokes callback(all_done, client_data) periodically (the
   driver uses it to update the progress display); returning non-zero aborts.
 - clips are accumulated per effect in effp->clips; sox_effects_clips sums all
   except the first and last (input/output) -- VERIFY against the reference's
   clip reporting.

lsx_report_effect_chain must reproduce exactly the -V3 output, e.g.:
  SOX INFO sox: effects chain: input         8000Hz  1 channels (multi) 16 bits 00:00:00.00
  SOX INFO sox: effects chain: dither        8000Hz  1 channels          8 bits 00:00:00.00
  SOX INFO sox: effects chain: output        8000Hz  1 channels (multi)  8 bits 00:00:00.00
Determine the exact column widths and when "(multi)" appears, when the bits
column is blank, and how the duration is formatted, by running the reference
with -V3 on many chains (mono/stereo, with rate/channels/trim effects, unknown
length inputs). Write your findings to /workspace/notes/effects_chain.md.

effects_i.c: small helpers used by many effects. Provide at least
  lsx_usage / lsx_usage_lines if util.c's author has not (coordinate by NOT
  defining them here -- util.c owns them), plus anything you need. Prefer to keep
  effects_i.c minimal; add helpers here only if generally useful and declare them
  in sox_i.h.

Also implement the built-in 'crop' effect in src/eff_crop.c -- WAIT: do not touch
that file, it belongs to another agent. Instead, note in your report what the
engine expects of it.`,
  },
]

const results = await parallel(tasks.map(t => () =>
  agent(COMMON + '\n\nYOUR ASSIGNMENT (only these files: ' + t.files + ')\n\n' + t.prompt,
        { label: t.label, phase: 'Core' })
))

return results.map((r, i) => ({ task: tasks[i].label, report: r }))
