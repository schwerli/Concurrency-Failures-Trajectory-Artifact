export const meta = {
  name: 'sox-effects',
  description: 'Implement all audio effects for the SoX reimplementation',
  phases: [ { title: 'Effects' } ],
}

const COMMON = `
You are implementing part of an original, from-scratch C re-implementation of the
command-line audio tool at /workspace/executable (self-identifies as "SoX v14.4.2").

CRITICAL RULES (violating these fails the whole project):
 - Learn behaviour ONLY by RUNNING /workspace/executable and reading the bundled
   man pages: /workspace/sox.1 (huge and authoritative -- READ THE SECTIONS FOR
   YOUR EFFECTS), /workspace/soxformat.7, /workspace/libsox.3, README.md.
 - NEVER search the web, fetch/clone/download upstream source, use a package
   manager to obtain the project, or read any copy of the original sources.
 - NEVER run objdump/gdb/ghidra/strace/ltrace/nm/readelf/strings on the binary.
 - Write ORIGINAL code; derive behaviour from experiments and from the manual.

Read FIRST: /workspace/notes/CONTRACT.md, /workspace/src/sox.h, /workspace/src/sox_i.h.
sox.h/sox_i.h are the fixed contract: you may ADD declarations, never change or
remove existing ones (other agents compile against them concurrently).

ONLY create/modify the files assigned to you, plus a notes file you own.
Never run 'git' write commands.

The project does not link yet (many modules are stubs), so you CANNOT run an
end-to-end comparison. Therefore:
 (a) probe the reference exhaustively and RECORD the observed numbers,
 (b) work out the algorithm that reproduces them,
 (c) implement it, and
 (d) compile-check each of your files:
       cc -c -std=gnu99 -I/workspace/src -O2 -Wall /workspace/src/FILE.c -o /tmp/o.o
     iterate until clean. Where useful, write a throwaway test harness in /tmp
     that links your file with tiny stubs so you can compare numbers against the
     reference.

HOW TO GET EXACT NUMBERS OUT OF THE REFERENCE
  # a deterministic input you can reason about, as text:
  /workspace/executable -n -r 8000 -c 1 -b 32 -e signed-integer /tmp/in.s32 \
      synth 0.01 sin 300
  # apply an effect and print 64-bit-float text samples (no dither, no rounding):
  /workspace/executable -D -t s32 -r 8000 -c 1 /tmp/in.s32 -t dat - <EFFECT ARGS>
  # or -t f64 - | od -An -tf8   for raw doubles
Always pass -D (no dither) and use -t f64/-t dat output so quantisation does not
hide the algorithm. Use single impulses (one sample = full scale, rest zero) to
read filter impulse responses straight out, and step functions for envelopes.
'-V3'/'-V4' often reveals internally computed coefficients -- check.

EFFECT MODULE CONVENTIONS
 - One file per effect: /workspace/src/eff_<name>.c exporting exactly
       sox_effect_handler_t const *lsx_<name>_effect_fn(void);
 - Put '#define LSX_MODULE_NAME "<name>"' at the very top, before including
   "sox_i.h", so diagnostics read 'PROG FAIL <name>: ...'.
 - handler.name must be the effect name, handler.usage the exact usage string
   the reference prints for './executable --help-effect <name>' MINUS the
   leading effect name (the driver prints '<name> <usage>' for --help-effect and
   'usage: <usage>' for an option error). Reproduce multi-line usage text
   including tabs exactly. Check with: ./executable --help-effect <name>
 - handler.flags: combine SOX_EFF_CHAN (changes channel count), SOX_EFF_RATE
   (changes rate), SOX_EFF_PREC (sets out_signal.precision itself),
   SOX_EFF_LENGTH (changes length), SOX_EFF_MCHAN (sees interleaved
   multi-channel data; otherwise the engine runs one instance per channel),
   SOX_EFF_MODIFY (does NOT modify sample values -- affects whether the driver
   auto-inserts dither), SOX_EFF_GAIN, SOX_EFF_ALPHA (experimental; the reference
   marks these with '+' in the effect list and prints
   "\`name' is experimental/incomplete"), SOX_EFF_INTERNAL (libSoX-only, marked
   '#'), SOX_EFF_DEPRECATED ('*').
   Determine each effect's flags from observable behaviour: whether dither gets
   auto-inserted (./executable -V3 -t s16 in.wav -t s16 out.wav <effect>), and
   whether the effect appears with a marker in './executable -h'.
 - getopts receives argc/argv with argv[0] being the FIRST OPTION (not the
   effect name). Use lsx_getopt_init(argc, argv, "shortopts", NULL, 0, 0, &state)
   then lsx_getopt(&state). Return lsx_usage(effp) on a bad option.
 - effp->priv is pre-allocated (handler.priv_size bytes) and zeroed.
 - flow(effp, ibuf, obuf, &isamp, &osamp): consume up to *isamp, produce up to
   *osamp, write back what you actually did. drain(effp, obuf, &osamp) is called
   after input EOF until it returns 0 samples / SOX_EOF.
 - Count clipping into effp->clips using SOX_ROUND_CLIP_COUNT / SOX_SAMPLE_CLIP_COUNT.
   The driver then prints 'PROG WARN <name>: <name> clipped N samples; decrease volume?'.
 - Set effp->out_signal.length when the effect changes the audio length so the
   output file header gets the right size (check by looking at the size field of
   a wav written through your effect... you cannot yet, so instead reason: the
   reference's '--i' Duration for e.g. 'trim'/'pad'/'repeat' output tells you
   what length it declared).

Final message: a SHORT report (< 35 lines): which effects you implemented, the
algorithm essentials you derived, what remains uncertain, header additions.
`;

phase('Effects')

const groups = [
  {
    label: 'biquads',
    files: 'eff_biquad.c eff_allpass.c eff_band.c eff_bandpass.c eff_bandreject.c eff_bass.c eff_treble.c eff_equalizer.c eff_highpass.c eff_lowpass.c eff_deemph.c eff_riaa.c',
    prompt: `Implement the biquad-filter family. Put the shared machinery in
src/eff_biquad.c (also exporting lsx_biquad_effect_fn for the user-visible
'biquad b0 b1 b2 a0 a1 a2' effect) and declare the shared helpers in sox_i.h
(a biquad_t is already declared there):
    int lsx_biquad_start(sox_effect_t effp);
    int lsx_biquad_flow(sox_effect_t effp, sox_sample_t const *ibuf,
                        sox_sample_t *obuf, size_t *isamp, size_t *osamp);
    int lsx_biquad_getopts(sox_effect_t effp, int argc, char **argv,
                           int min_args, int max_args, int fc_pos, int width_pos,
                           int gain_pos, char const *allowed_width_types,
                           filter_t filter_type);

Effects and their sox.1 definitions (READ the 'allpass', 'band', 'bandpass',
'bandreject', 'bass', 'treble', 'equalizer', 'highpass', 'lowpass', 'deemph',
'riaa', 'biquad' sections of /workspace/sox.1 -- they give the exact transfer
functions and coefficient formulas):
  allpass frequency width[h|k|q|o]
  band [-n] center [width[h|k|q|o]]
  bandpass [-c] frequency width[h|k|q|o]
  bandreject frequency width[h|k|q|o]
  bass gain [frequency(100) [width[s|h|k|q|o]](0.5s)]
  treble gain [frequency(3000) [width[s|h|k|q|o]](0.5s)]
  equalizer frequency width[q|o|h|k] gain
  highpass [-1|-2] frequency [width[q|o|h|k](0.707q)]
  lowpass [-1|-2] frequency [width[q|o|h|k]](0.707q)
  deemph      (a fixed shelving filter for CD de-emphasis, 44100 Hz only)
  riaa        (RIAA vinyl playback equalisation; fixed coefficients per rate)
  biquad b0 b1 b2 a0 a1 a2

Verify coefficients numerically: the reference prints them with --plot! e.g.
  ./executable --plot gnuplot -n -n lowpass 1000
  ./executable --plot octave  -n -n bass 6 200 0.7s
prints a script containing the exact b/a coefficients. Use this for EVERY filter
and every width type (q, o, h, k, s) and several rates (the null device is
48000 Hz by default; use '-r 44100 -n' to change it). This gives you exact
ground truth -- match it to the last digit where you can.
Also verify the actual filtering by feeding an impulse and dumping -t f64.
Note: 'deemph' and 'riaa' only work at particular rates; determine the error
message for other rates. 'riaa' supports 44100/48000/88200/96000 -- get the
coefficient sets from --plot at each rate.
Write findings to /workspace/notes/eff_biquads.md.`,
  },
  {
    label: 'gain',
    files: 'eff_vol.c eff_gain.c eff_norm.c eff_dcshift.c eff_contrast.c eff_overdrive.c eff_loudness.c eff_dither.c eff_earwax.c',
    prompt: `Implement: vol, gain, norm, dcshift, contrast, overdrive, loudness,
dither, earwax. Read their sections in /workspace/sox.1.

  vol GAIN [TYPE [LIMITERGAIN]]     TYPE = amplitude|power|dB
  gain [-e|-b|-B|-r] [-n] [-l|-h] [gain-dB]
  norm [level]                      (equivalent to 'gain -n level')
  dcshift shift [limitergain]
  contrast [enhancement (75)]
  overdrive [gain [colour]]
  loudness [gain [ref]]             (ISO 226 loudness-compensated volume;
                                     implemented as a filter -- use --plot!)
  dither [-S|-s|-f filter] [-a] [-p precision]
  earwax                            (a fixed FIR for headphone crossfeed at 44100)

IMPORTANT -- 'dither' is auto-inserted by the driver whenever the output
precision is lower than the chain's precision, so it is on the critical path for
almost every conversion. Get it EXACTLY right:
 - Default is TPDF (triangular PDF) noise of 1 LSB at the target precision.
 - The pseudo-random generator is a linear congruential
   x = 1664525*x + 1013904223 (this is the reference's; verify). With the global
   -R option the seed is fixed, making runs reproducible -- find the seed by
   experiment. Without -R the seed depends on time+pid (so only -R runs are
   comparable; ALWAYS test with -R).
 - Determine the exact arithmetic: for a target of N bits, what is added to each
   32-bit sample before the format writer rounds? Solve it from
     printf-generated known inputs, e.g.
     python3 -c "import struct,sys;sys.stdout.buffer.write(b''.join(struct.pack('<i',v) for v in [0]*32))" > /tmp/z.s32
     /workspace/executable -R -t s32 -r 8000 -c 1 /tmp/z.s32 -t s8 - | od -An -td1
   With an all-zero input the output IS the dither sequence. Recover the exact
   sequence and match it. Repeat for -t s16 and -t u8 and different -p values,
   and with 'dither -S'.
 - 'dither -s' / '-f NAME' apply noise shaping with named filters (lipshitz,
   f-weighted, modified-e-weighted, improved-e-weighted, gesemann, shibata,
   low-shibata, high-shibata). Each is a fixed FIR error-feedback filter, and
   the coefficients differ per sample rate for the shibata family. Recover what
   you can from all-zero and impulse inputs at 44100 Hz; if you cannot recover a
   filter exactly, implement the structure with your best-fit coefficients and
   SAY SO in your report and notes.
 - '-a' enables dither only when needed; '-p bits' overrides the target precision.
 - The driver prints 'WARN dither: dither clipped N samples; decrease volume?'.

'gain': the -e/-b/-B/-r/-n/-l/-h options need care -- -n normalises to 0 dBFS,
-r reclaims headroom reserved by an earlier 'gain -h', -b/-B balance channels by
RMS, -e equalises by peak, -l uses a simple limiter. Several of these require two
passes over the audio, which the effect does by buffering everything in memory
(check with a large file that memory grows). Determine the exact limiter curve
for -l and for vol's LIMITERGAIN / dcshift's limitergain (they share a soft
limiter; derive its formula from a ramp input, e.g. synth a sawtooth and dump
input and output as -t dat and fit the curve).

Write findings, especially the dither sequence and limiter formula, to
/workspace/notes/eff_gain.md.`,
  },
  {
    label: 'edit',
    files: 'eff_trim.c eff_pad.c eff_delay.c eff_repeat.c eff_reverse.c eff_crop.c eff_splice.c eff_silence.c eff_fade.c',
    prompt: `Implement: trim, pad, delay, repeat, reverse, splice, silence, fade,
plus the driver-internal 'crop' effect (src/eff_crop.c -- the reference uses it
internally for the 'trim'-like cropping the driver needs; make it a
non-user-visible effect with SOX_EFF_INTERNAL whose usage is empty; if you find
no evidence of it, implement it as an alias of trim and say so).

  trim {position}         -- see the extensive 'trim' section of /workspace/sox.1
  pad {length[@position]}
  delay {position}        -- one position per channel
  repeat [count (1)]
  reverse
  splice [-h|-t|-q] {position[,excess[,leeway]]}
  silence [-l] above_periods [duration threshold[d|%]] [below_periods duration threshold[d|%]]
  fade [type] fade-in-length [stop-position [fade-out-length]]   type = q|h|t|l|p

Verify sample-exactly. Technique: build an input whose samples are their own
index so you can see precisely which samples survive:
  python3 -c "
import struct,sys
sys.stdout.buffer.write(b''.join(struct.pack('<i', i*100000) for i in range(200)))" > /tmp/r.s32
  /workspace/executable -D -t s32 -r 100 -c 1 /tmp/r.s32 -t dat - trim 0.1 0.5
Then read off the first/last surviving indices. Do this for every option form,
including negative/relative positions, multiple positions, and multi-channel
inputs. For 'fade' derive each curve type exactly (q=quarter sine, h=half sine,
t=triangular/linear, l=logarithmic, p=inverted parabola) by fading a constant
full-scale signal and dumping -t dat: the output IS the envelope.
For 'silence' work out the threshold semantics ('d' = dB, '%' = percentage),
the meaning of above_periods/below_periods (including 0 and negative), and the
-l (leave silence) flag.
For 'splice' derive the cross-fade shapes (-h half sine, -t triangular,
-q quarter sine) and the default excess/leeway (0.005 s each).
Also set effp->out_signal.length correctly for length-changing effects.
Write findings to /workspace/notes/eff_edit.md.`,
  },
  {
    label: 'channels',
    files: 'eff_channels.c eff_remix.c eff_swap.c eff_oops.c eff_divide.c eff_input.c eff_output.c eff_ladspa.c',
    prompt: `Implement: channels, remix, swap, oops, divide, and the placeholder
'input'/'output'/'ladspa' effects.

  channels number          -- change the channel count (down-mix / up-mix)
  remix [-m|-a] [-p] <0|in-chan[v|p|i volume]{,in-chan[v|p|i volume]}>
  swap                     -- swap stereo channels
  oops                     -- out-of-phase stereo ("karaoke")
  divide                   -- experimental (marked '+'); determine what it does
  input / output           -- listed by the reference as libSoX-only ('#'); their
                              --help-effect output is just the name and the line
                              "\`input' is libSoX-only". Implement them as
                              SOX_EFF_INTERNAL no-ops with empty usage.
  ladspa MODULE [PLUGIN] [ARGUMENT...]
                           -- the reference is built with LADSPA support but
                              there are no plugins available; determine the error
                              it gives for a missing module and reproduce that.
                              Do not implement actual plugin loading.

Read the 'channels', 'remix', 'swap', 'oops' sections of /workspace/sox.1.

Determine the exact down-mix/up-mix arithmetic for 'channels' (2->1, 1->2, 2->4,
4->2, 3->2, 2->3, ...) using an input where the two channels differ, e.g.
  python3 -c "
import struct,sys
sys.stdout.buffer.write(b''.join(struct.pack('<ii', 1000000, -3000000) for i in range(4)))" > /tmp/st.s32
  /workspace/executable -D -t s32 -r 8000 -c 2 /tmp/st.s32 -t dat - channels 1
Work out whether it averages, sums, or applies a gain, and whether it clips.
CRITICALLY: determine when 'channels' causes the driver to auto-insert dither
(run './executable -V3 stereo16.wav -t s16 out.wav channels 1' vs 'channels 4')
and set SOX_EFF_PREC / out_signal.precision to match.
For 'remix', cover: plain channel lists, '0' (silence), the -m/-a/-p flags, the
'v'/'p'/'i' volume specifiers, and the automatic gain compensation. Also
determine the error messages for invalid specs.
Write findings to /workspace/notes/eff_channels.md.`,
  },
  {
    label: 'delays',
    files: 'eff_echo.c eff_echos.c eff_chorus.c eff_flanger.c eff_phaser.c eff_tremolo.c eff_reverb.c',
    prompt: `Implement: echo, echos, chorus, flanger, phaser, tremolo, reverb.
Read their sections in /workspace/sox.1 (they describe the structures in detail,
and 'flanger' has a full block diagram in './executable --help-effect flanger').

  echo gain-in gain-out delay decay [delay decay ...]
  echos gain-in gain-out delay decay [delay decay ...]
  chorus gain-in gain-out delay decay speed depth [-s|-t]
  flanger [delay depth regen width speed shape phase interp]
  phaser gain-in gain-out delay decay speed [-s|-t]
  tremolo speed_Hz [depth_percent]
  reverb [-w|--wet-only] [reverberance (50%) [HF-damping (50%) [room-scale (100%)
          [stereo-depth (100%) [pre-delay (0ms) [wet-gain (0dB)]]]]]]

Derive each exactly from impulse responses. An impulse input makes the whole
structure visible:
  python3 -c "
import struct,sys
sys.stdout.buffer.write(struct.pack('<i', 2000000000) + b'\\0'*4*4000)" > /tmp/imp.s32
  /workspace/executable -D -t s32 -r 8000 -c 1 /tmp/imp.s32 -t dat - echo 0.8 0.9 60 0.4
Read off tap positions (in samples) and amplitudes; that gives the delay-line
lengths, rounding, and gain arithmetic exactly. For the modulated effects
(chorus, flanger, phaser) also feed a constant DC signal to expose the LFO shape
and the interpolation used on the delay line ('-s' sinusoidal vs '-t'
triangular; flanger's 'lin' vs 'quad' interp).
'reverb' is a Schroeder/Freeverb-style network; recover as much structure as you
can from the impulse response (comb/allpass delay lengths are visible as spikes;
the number of combs and allpasses and their feedback gains follow). Document what
you could and could not determine. Note reverb's behaviour for stereo input and
the stereo-depth parameter, and that it may output more channels than it takes
(check './executable -V3 mono.wav -t s16 out.wav reverb' channel counts).
For tremolo determine whether it is implemented via an amplitude-modulating
LFO of a particular shape and phase (dump the envelope with a DC input).
Write findings to /workspace/notes/eff_delays.md.`,
  },
  {
    label: 'compand',
    files: 'eff_compand.c eff_mcompand.c',
    prompt: `Implement: compand and mcompand. Read the 'compand' and 'mcompand'
sections of /workspace/sox.1 carefully -- they document the transfer-function
and envelope-follower semantics in detail.

  compand attack1,decay1{,attack2,decay2} [soft-knee-dB:]in-dB1[,out-dB1]{,in-dB2,out-dB2} [gain [initial-volume-dB [delay]]]
  mcompand quoted_compand_args [crossover_frequency[k] quoted_compand_args [...]]

Derive exactly:
 - how the transfer function is built from the (in-dB,out-dB) breakpoints,
   including the soft-knee interpolation (the manual describes a quadratic
   knee), the implicit segments beyond the first/last breakpoint, and the
   handling of '-inf'.
 - the attack/decay envelope follower: one-pole per-sample smoothing; determine
   the exact coefficient from the attack/decay time constants and the sample
   rate by feeding a step (silence -> full scale) and dumping -t dat.
 - the 'delay' parameter (a look-ahead delay implemented as a buffer).
 - multiple attack/decay pairs apply to successive channels.
 - mcompand splits into bands with Linkwitz-Riley crossovers (determine the
   order and coefficients using --plot or an impulse per band), compands each,
   and sums them.

Technique: use a step, a ramp, and a decaying sinusoid, always with -D and
-t dat output, and compare against your implementation compiled as a standalone
test in /tmp. Also verify -V3 does not print anything extra you are missing.
Write findings to /workspace/notes/eff_compand.md.`,
  },
  {
    label: 'rate',
    files: 'eff_rate.c eff_upsample.c eff_downsample.c eff_speed.c eff_sinc.c eff_hilbert.c eff_fir.c eff_firfit.c',
    prompt: `Implement: rate, upsample, downsample, speed, sinc, hilbert, fir, firfit.
Read the 'rate', 'sinc', 'hilbert', 'fir', 'upsample', 'downsample', 'speed'
sections of /workspace/sox.1.

  rate [-q|-l|-m|-h|-v] [override-options] RATE[k]
       overrides: -M/-I/-L phase, -s steep, -a allow aliasing, -b 74-99.7
       band-width %, -p 0-100 phase
  upsample [factor (2)]      -- zero-stuffing, no filter
  downsample [factor (2)]    -- decimation, no filter
  speed factor[c]            -- change rate and pitch (resample by adjusting rate)
  sinc [-a att|-b beta] [-p phase|-M|-I|-L] [-t tbw|-n taps] [freqHP][-freqLP [-t tbw|-n taps]]
  hilbert [-n taps]
  fir [coef-file|coefs]
  firfit [knots-file]        -- experimental ('+'); determine and reproduce
                                whatever it actually does (it may just error)

'rate' is the most important and hardest: it is a high-quality polyphase
resampler. Use these levers to pin it down:
 - './executable --plot gnuplot -n -n rate -h 8000' etc. may print the filter.
 - '-V3'/'-V4' with 'rate' prints internal details about the chosen filter,
   number of taps, phase, multi-stage factorisation and so on -- capture that
   output for many rate ratios and quality levels and reproduce the same
   decisions AND the same log lines.
 - Feed an impulse at rate R and dump the output at rate R2 as -t f64 to see the
   interpolation kernel directly.
Aim for output that matches the reference to within a few LSB at 16-bit, and be
honest in your report about the accuracy achieved. Use the shared DSP helpers
(lsx_design_lpf, lsx_make_lpf, lsx_fir_to_phase, lsx_safe_rdft) from src/dsp.c
(another agent is writing it; the declarations in sox_i.h are authoritative).
'sinc' and 'hilbert' are FIR filters built with the same helpers -- validate them
with --plot, which gives exact coefficients.
'fir' takes coefficients on the command line or from a file; determine the file
format (whitespace-separated numbers? comments?) by experiment.
Write findings, especially all the -V3/-V4 log lines 'rate' emits, to
/workspace/notes/eff_rate.md.`,
  },
  {
    label: 'stretch',
    files: 'eff_tempo.c eff_pitch.c eff_stretch.c eff_bend.c',
    prompt: `Implement: tempo, pitch, stretch, bend. Read their sections in
/workspace/sox.1.

  tempo [-q] [-m|-s|-l] factor [segment-ms [search-ms [overlap-ms]]]
  pitch [-q] shift-in-cents [segment-ms [search-ms [overlap-ms]]]
  stretch factor [window fade shift fading]
  bend [-f frame-rate(25)] [-o over-sample(16)] {start,cents,end}

'tempo' is a WSOLA-style time stretcher; 'pitch' is 'tempo' plus a rate change;
'stretch' is a simpler (deprecated-quality) time stretcher; 'bend' is a
phase-vocoder-style pitch bender.

Derive the algorithms as precisely as you can:
 - the default segment/search/overlap values for each of -m (music), -s (speech),
   -l (linear) modes, and what -q changes. '-V3'/'-V4' output may reveal the
   parameters actually used -- capture it and reproduce those log lines.
 - the exact output length for a given input length and factor (compare
   './executable --i' Duration of the output for many factors).
 - the overlap window shape and the cross-correlation search used to pick the
   splice point. Use a click train (impulses every N samples) as input: the
   output click positions reveal the segment boundaries and the search decision.
 - 'bend' uses an FFT; determine the frame rate / over-sample semantics and the
   {start,cents,end} triple parsing (times parsed by lsx_parsesamples).
Aim for close numerical agreement; document what you achieved and the exact
output lengths, which are the most testable property. Write findings to
/workspace/notes/eff_stretch.md.`,
  },
  {
    label: 'analysis',
    files: 'eff_stat.c eff_stats.c eff_noiseprof.c eff_noisered.c eff_vad.c',
    prompt: `Implement: stat, stats, noiseprof, noisered, vad. Read their sections
in /workspace/sox.1.

  stat [-s N] [-rms] [-freq] [-v] [-d]
  stats [-b bits|-x bits|-s scale] [-w window-time]
  noiseprof [profile-file]
  noisered [profile-file [amount]]
  vad [options]   (see './executable --help-effect vad' for the full option list)

'stat' and 'stats' print a report to stderr; their output must match the
reference EXACTLY, character for character. Capture many examples:
  /workspace/executable -D -t s32 -r 8000 -c 1 /tmp/in.s32 -n stat
  /workspace/executable -D -t s32 -r 8000 -c 1 /tmp/in.s32 -n stats
  ... with -s/-rms/-freq/-v/-d, mono and stereo, empty input, DC input,
  full-scale input, and with -b/-x/-s/-w for stats.
Observed 'stat' layout (verify and complete):
    Samples read:                11
    Length (seconds):      0.001375
    Scaled by:         2147483647.0
    Maximum amplitude:     0.999969
    Minimum amplitude:    -1.000000
    Midline amplitude:    -0.000015
    Mean    norm:          0.274703
    Mean    amplitude:    -0.000006
    RMS     amplitude:     0.476739
    Maximum delta:         1.999969
    Minimum delta:         0.000000
    Mean    delta:         0.603564
    RMS     delta:         0.867016
    Rough   frequency:         2207
    Volume adjustment:        1.000
Observed 'stats' layout (verify and complete; note stats prints one column per
channel plus an overall column for multi-channel input):
    DC offset  -0.000006
    Min level  -1.000000
    Max level   0.999969
    Pk lev dB       0.00
    RMS lev dB     -6.43
    RMS Pk dB      -6.43
    RMS Tr dB      -6.43
    Crest factor    2.10
    Flat factor     0.00
    Pk count           2
    Bit-depth      16/16
    Num samples       11
    Length s       0.001
    Scale max   1.000000
    Window s       0.050
Work out every field's definition and exact printf format (column widths!) by
fitting to many inputs. 'stat -freq' prints a frequency spectrum; 'stat -v'
prints only the volume adjustment number; '-d' prints... determine it.
Also note 'stat' passes audio through unchanged and, when used with '-n' output,
the reference additionally prints "Can't guess the type" -- work out where that
comes from (it is probably a separate diagnostic from the null handler; ignore it
if it is not stat's).
'noiseprof' writes a noise profile to a file (or stdout); determine the exact
text format. 'noisered' applies spectral subtraction using it; determine the FFT
size, window and the 'amount' semantics.
'vad' is a voice-activity trimmer with many parameters; implement the structure
described by the option list and validate the trim points on speech-like input.
Write findings to /workspace/notes/eff_analysis.md.`,
  },
  {
    label: 'synth',
    files: 'eff_synth.c',
    prompt: `Implement the 'synth' effect in src/eff_synth.c. Read the long
'synth' section of /workspace/sox.1 -- it is the authority for the syntax.

  synth [-j KEY] [-n] [length [offset [phase [p1 [p2 [p3]]]]]]
        {type [combine] [[%]freq[k][:|+|/|-[%]freq2[k]] [offset [phase [p1 [p2 [p3]]]]]}

Types include: sine, square, triangle, sawtooth, trapezium, exp, [white]noise,
pinknoise, brownnoise, tpdfnoise, and the 'pluck' family -- determine the full
list from the manual and by trying names (the reference will reject unknown
ones with a message you must reproduce).
Combine methods: create, mix, amod, fmod, and possibly others -- check the manual.
Frequency can be given as a note ('%-12'), a plain Hz value, or with 'k'; a
sweep is given as freq:freq2 (linear), freq+freq2, freq/freq2 (logarithmic),
freq-freq2 -- determine each one's interpolation exactly.

Verify numerically by dumping -t dat / -t f64 for short lengths at a low rate:
  /workspace/executable -D -n -r 100 -c 1 -t dat - synth 0.2 sin 10
  /workspace/executable -D -R -n -r 100 -c 1 -t dat - synth 0.2 whitenoise
Determine: the phase convention (0 phase = ?), the offset/p1/p2/p3 semantics per
type, how 'length' interacts with the input length when synth is used on real
input (it can be 0 meaning "as long as the input"), and the exact noise
generators (with -R they are reproducible -- recover the sequences; the LCG
x = 1664525*x + 1013904223 is used, see /workspace/notes/prng.md if it exists).
Also determine what '-n' and '-j KEY' do, and the number of output channels
(one generator per channel; more generators than input channels increases the
channel count -- check with -V3).
Write findings to /workspace/notes/eff_synth.md.`,
  },
]

const results = await parallel(groups.map(g => () =>
  agent(COMMON + '\n\nYOUR ASSIGNMENT. Create these files under /workspace/src/ (and only these): '
        + g.files + '\n\n' + g.prompt,
        { label: g.label, phase: 'Effects' })
))

return results.map((r, i) => ({ group: groups[i].label, report: r }))
