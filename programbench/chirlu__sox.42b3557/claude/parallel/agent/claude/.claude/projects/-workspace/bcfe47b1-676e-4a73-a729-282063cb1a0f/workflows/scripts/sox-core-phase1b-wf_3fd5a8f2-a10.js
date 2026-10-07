export const meta = {
  name: 'sox-core-phase1b',
  description: 'Implement the format registry and the command-line driver',
  phases: [ { title: 'Driver' } ],
}

const COMMON = `
You are implementing part of an original, from-scratch C re-implementation of the
command-line audio tool at /workspace/executable (self-identifies as "SoX v14.4.2").

CRITICAL RULES (violating these fails the whole project):
 - Learn behaviour ONLY by RUNNING /workspace/executable and reading the bundled
   man pages /workspace/sox.1, /workspace/soxformat.7, /workspace/libsox.3, README.md.
 - NEVER search the web, fetch/clone/download upstream source, use a package
   manager to obtain the project, or read any copy of the original sources.
 - NEVER run objdump/gdb/ghidra/strace/ltrace/nm/readelf/strings on the binary.
 - Write ORIGINAL code; derive behaviour from experiments.

Read FIRST: /workspace/notes/CONTRACT.md, /workspace/notes/driver.md (a detailed
record of already-measured reference behaviour -- trust it, and extend it),
/workspace/src/sox.h, /workspace/src/sox_i.h.

sox.h/sox_i.h are the fixed contract. You may ADD declarations but never change
or remove existing ones -- other agents compile against them concurrently.

ONLY create/modify the files assigned to you (plus notes/*.md you own).
Never run 'git' write commands.

Other modules are still stubs, so a full link will fail. Check your file with:
    cc -c -std=gnu99 -I/workspace/src -O2 -Wall /workspace/src/YOURFILE.c -o /tmp/o.o
Iterate until it compiles cleanly.

Final message: a SHORT report (< 30 lines) of what you implemented, what you
could not determine, and any header additions.
`;

phase('Driver')

const tasks = [
  {
    label: 'formats',
    files: 'src/formats.c',
    prompt: `Implement /workspace/src/formats.c: the format registry and the
sox_open_read / sox_open_write / sox_read / sox_write / sox_close / sox_seek API
declared in sox.h, plus sox_init/sox_quit/sox_format_init/sox_format_quit,
lsx_set_signal_defaults, the sox_encodings_info table is owned by util.c (do NOT
define it), and the help output for formats.

Responsibilities:

1. Build the handler table from src/formats.h (each lsx_<mod>_format_fn(); skip
   the ones that currently return NULL). Look up handlers by name
   case-insensitively across every name in handler->names.

2. File-type determination for input:
   a. an explicit -t/--type name;
   b. otherwise sniff the header ("magic") -- the reference reports
      'INFO formats: detected file format type \`wav'' at -V3. Determine which
      formats are detected by magic and the exact byte signatures by creating a
      file of each type with the reference and then reading it back with a
      mismatched extension, e.g.
        ./executable -n -r 8000 f.dat synth 0.01 sin 300   # then
        cp f.dat g.bin && ./executable -V3 --i g.bin
      Cover at least: wav (RIFF/RIFX), aiff/aifc (FORM), au (.snd), sox (.SoX),
      voc (Creative Voice File), sph/nist (NIST_1A), 8svx (FORM..8SVX),
      maud (FORM..MAUD), smp (SOUND SAMPLE DATA), avr (2BIT), sndt, dvms/cvsd,
      hcom, txw, wve (ALawSoundFile**), gsrt, prc, xa, dat (starts with ';'),
      htk. Record exactly which ones are magic-detected and which are only
      recognised by extension in /workspace/notes/magic.md.
   c. otherwise the filename extension;
   d. failing that: 'FAIL formats: can't determine type of file \`X''.
   Note the reference has a --no-glob option and expands wildcards in input
   names, and supports "|command" and "http://" inputs -- the driver handles
   those, not you.

3. sox_open_read(path, signal, encoding, filetype):
   - "-" means stdin. Open the file, allocate the sox_format_t and its priv,
     copy in any user-supplied signal/encoding overrides, call handler->startread,
     then fill in defaults. On failure print
       'FAIL formats: can't open input file \`X': <strerror>'
     and return NULL. Set ft->seekable appropriately.
   - After startread, ft->signal.precision must be set via lsx_precision() if the
     handler left it 0.
4. sox_open_write(path, signal, encoding, filetype, comments, overwrite_permitted):
   - "-" means stdout. Honour the overwrite_permitted callback (used by
     --no-clobber; determine the exact prompt text from the reference by running
     './executable --no-clobber existing.wav existing2.wav' with an existing
     output). Print 'FAIL formats: can't open output file \`X': <strerror>' on
     failure.
   - Check the handler's channel/rate restrictions (see --help-format output:
     "Channels restricted to: mono stereo", "Sample-rate restricted to: 44100").
     Determine the exact error/warning the reference gives when violated, e.g.
       ./executable stereo.wav -t cvsd out.cvsd
       ./executable -r 22050 in.wav -t cdda out.cdr
     and reproduce it.
5. sox_read/sox_write: call the handler, apply ft->signal.mult (the -v volume
   factor) on read if set, accumulate ft->clips, track ft->olength.
6. sox_close: call stopread/stopwrite, close the file (unless it is stdin/stdout).
7. sox_seek(ft, offset, SOX_SEEK_SET): delegate to handler->seek.
8. Help output. Implement two functions (declare them in sox_i.h):
       void lsx_display_supported_formats(void);   /* the AUDIO FILE FORMATS,
             PLAYLIST FORMATS and AUDIO DEVICE DRIVERS lines of './executable -h' */
       int lsx_usage_format(char const *name);     /* './executable --help-format X' */
   The formats line is the sorted (by strcmp) list of every name of every
   non-phony handler; check byte-for-byte against './executable -h'. Reproduce
   '--help-format=all' and '--help-format wav' exactly (see the reference).
   PLAYLIST FORMATS is the fixed list 'm3u pls'; AUDIO DEVICE DRIVERS is
   'oss ossdsp'.
   Also provide char const *lsx_encoding_name(sox_encoding_t, unsigned bits) style
   helper used to print '16-bit Signed Integer PCM' / '8-bit u-law' /
   'Floating Point (text) PCM' / 'LPC10' -- note encodings with no bit prefix.

9. Implement the output-encoding-selection helper described in
   /workspace/notes/driver.md section "Output encoding selection" as
       void lsx_choose_encoding(sox_format_handler_t const *h,
                                sox_encodinginfo_t *enc, unsigned target_precision);
   (declare in sox_i.h) so the driver can call it. Re-verify the rules with your
   own matrix of experiments and refine them if they are not exactly right.

Do not implement the individual formats; they are separate files owned by others.`,
  },
  {
    label: 'driver',
    files: 'src/sox_main.c',
    prompt: `Implement /workspace/src/sox_main.c: the whole command-line driver
(equivalent of the reference's main program), including its soxi mode.

/workspace/notes/driver.md already records, measured from the reference: the
banner, all diagnostic formats, exit statuses, the soxi usage text and per-option
outputs, the file-info block layout, the 3-significant-figure number format, the
progress meter layout and VU table, the output-encoding selection algorithm and
the auto-inserted-effect ordering. Follow it, and VERIFY everything again
yourself; extend the notes file with anything new (append only).

Implement:

* main(): decide the mode from basename(argv[0]) -- 'sox', 'play', 'rec', 'soxi'
  -- and from --i/--info (soxi) . For 'play' the output is the default device and
  --combine defaults to 'sequence'; for 'rec' the single file name is the output
  and the input is the default device; replay-gain defaults to 'track' for play.
  Determine the exact differences by running
  'ln -s /workspace/executable /tmp/play && /tmp/play --help' etc. -- the usage
  text changes per mode, so capture all four variants ('sox', 'play', 'rec',
  'soxi') byte-for-byte and reproduce them.
* Full option parsing: every global option listed by './executable -h' and every
  format option. Format options apply to the next file name; global options may
  appear anywhere before the first effect. Include: --buffer, --input-buffer,
  --clobber/--no-clobber, --combine (concatenate|sequence|mix|mix-power|merge|
  multiply), -m/-M/-T shortcuts, -D, --dft-min, --effects-file, -G, -h,
  --help-effect, --help-format, --i/--info, --multi-threaded/--single-threaded,
  --norm, --play-rate-arg, --plot, -q, --replay-gain, -R, -S, --temp, --version,
  -V[level], and format options -v/--volume, --ignore-length, -t, -e, -b, -N, -X,
  --endian, -L, -B, -x, -c, -r, -C, --add-comment, --comment, --comment-file,
  --no-glob. Wildcards in input file names are glob()-expanded unless --no-glob
  precedes the name. Also support the special names '-', '-d'/--default-device,
  '-n'/--null, '-p'/--sox-pipe, '|command' and 'http://...'.
* The complete usage text for -h (and the abbreviated failure usage). Capture it
  from the reference with './executable -h' and reproduce byte-for-byte, for all
  four invocation names. Note the AUDIO FILE FORMATS / EFFECTS lines come from
  formats.c / effects.c helpers.
* soxi mode: exactly as documented in notes/driver.md; exit 1 on any file error.
* The input combiner: implement it as an internal effect named "input" (the
  chain display shows 'input') that reads from all the input files according to
  the combine method: concatenate (one after another), sequence (separate chains
  per file), mix, mix-power, merge, multiply. For mix, samples are summed with
  each input scaled -- determine the exact scaling by experiment
  ('-m' two identical files vs one file, and 'mix-power'). Verify that
  '-m f f -t s32 out' gives exactly double the samples of 'f -t s32 out' or
  whatever the reference actually does, and that the input volume option -v and
  replay-gain are folded into the same multiplier.
  Also implement the internal "output" effect that writes to the output file.
* Checks: all inputs must have the same sample rate (FAIL) and a warning when
  channel counts differ (see notes/driver.md).
* Effects-chain construction: parse the trailing words as effects (a word that
  is not a known effect name where a file name is still expected is a file
  name); support multiple chains separated by ':' and the 'newfile' and
  'restart' pseudo-effects (check './executable' behaviour and sox.1 for these).
  Add auto effects in the documented order. --effects-file reads effects from a
  file (one chain per line? determine it).
* -G/--guard prepends 'gain -h'; --norm implies -G and additionally normalises,
  which requires writing to a temporary file and a second pass -- determine
  exactly what the reference does (run './executable -V3 --norm in.wav out.wav'
  and look at all the output) and reproduce.
* Progress display (-S) and the final 'Done.'; clip reporting at the end of the
  run for each effect and for the output file.
* The file-info display for input and output files.
* Sensible cleanup: delete the output file on failure? CHECK what the reference
  does when an effect fails mid-run.

You may add small helpers to sox_i.h. formats.c provides
lsx_display_supported_formats(), lsx_usage_format(), lsx_choose_encoding() and
lsx_encoding_name(); effects.c provides sox_find_effect(), the chain API and
lsx_report_effect_chain(); util.c provides lsx_sigfigs3()/lsx_sigfigs3p() and the
message primitives. Declare anything else you need and note it in your report.

Put '#define LSX_MODULE_NAME "sox"' at the top of the file (before including
sox_i.h) so diagnostics read 'PROG FAIL sox: ...'.

Append your findings (all four usage texts, --norm behaviour, combine scaling,
effects-file syntax, newfile/restart) to /workspace/notes/driver.md.`,
  },
]

const results = await parallel(tasks.map(t => () =>
  agent(COMMON + '\n\nYOUR ASSIGNMENT (only these files: ' + t.files + ')\n\n' + t.prompt,
        { label: t.label, phase: 'Driver' })
))

return results.map((r, i) => ({ task: tasks[i].label, report: r }))
