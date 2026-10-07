export const meta = {
  name: 'seqtk-characterize',
  description: 'Behaviorally characterize every subcommand of the reference seqtk binary',
  phases: [
    { title: 'Probe', detail: 'one agent per subcommand group, writes a spec note' },
    { title: 'Critique', detail: 'completeness critic per note' },
  ],
}

const RULES = `
HARD RULES (violating these fails the whole benchmark):
- The ONLY source of truth is running /workspace/executable and /workspace/README.md.
- Do NOT search the web. Do NOT look for or read the original project's source code anywhere
  (no github, no package managers, no pip/apt/cargo/go, no vendored copies).
- Do NOT disassemble/decompile /workspace/executable. Do NOT run objdump/nm/gdb/ghidra/strings/strace/ltrace on it.
  (You MAY use those on binaries you compile yourself.)
- You may run /workspace/executable with any inputs/flags as many times as you like.

CONTEXT: /workspace/executable is 'seqtk' version 1.5-r133, a FASTA/FASTQ toolkit.
Shared fixtures live in /workspace/tests/data (basic.fa basic.fq multiline.fq rich.fa rich.fq
pe1.fq pe2.fq many.fa many.fq genome.fa het.fa basic.fa.gz). Make your own extra fixtures in
/tmp as needed. Run from /workspace.

Already-established shared facts about the record parser (kseq-like) - assume these, do not re-derive:
- Input may be plain or gzip; "-" or absent filename means stdin. Missing file =>
  stderr "[E::stk_<cmd>] failed to open the input file/stream." and exit 1.
- Parser skips bytes until '>' or '@'. Header: name = chars up to first isspace (delimiter consumed);
  if the delimiter was not '\\n', the REST OF THE LINE (including any further leading spaces) is the comment.
- Sequence: lines accumulated until a line starts with '>' or '+' or '@' (or EOF). Blank lines skipped.
  Trailing '\\r' stripped per line. Spaces/tabs inside a sequence line are KEPT.
- If a '+' line is found, quality lines are accumulated until qual length >= seq length; if the
  totals differ the record is DISCARDED and parsing stops (silently, exit 0).
- If no '+' line, the record is FASTA (qual empty).

YOUR JOB: exhaustively characterize the assigned subcommand(s) so that someone who has never
seen the binary can reimplement it byte-for-byte from your notes alone.

For each assigned subcommand determine and record:
1. The exact usage/help text, byte for byte (get it with: script -qc "./executable CMD" /dev/null,
   which gives it a tty; note whether usage goes to stdout or stderr and the exit code).
2. Exact behavior of every option, including defaults, interactions, and precedence.
3. How unknown options are handled (exact message text, exit code, whether it continues).
4. The exact output format: field order, separators (tab vs space), number formatting
   (integers? %f? how many decimals? scientific?), header lines, trailing newlines.
5. The underlying ALGORITHM, stated precisely enough to reimplement. Where an algorithm is
   non-obvious (scoring, dropoff, windows, trimming), design small hand-made inputs that let you
   infer the recurrence/formula, then VERIFY your formula predicts outputs on fresh random inputs.
   Write a small python model and diff it against the binary on >=50 random cases. Report the
   verification result honestly, including any case you could not explain.
6. Edge cases: empty input, empty sequence, length-0 records, records shorter than window/params,
   lowercase, N/IUPAC ambiguity codes, non-ACGT characters, very long lines, 1-record input,
   negative/zero/huge option values, both FASTA and FASTQ input, multi-line records.
7. Any crash / assertion / non-zero exit you can trigger, with the exact stderr text.

Write your findings to the file named below. Be concrete: include literal command lines and
their literal outputs as evidence. Prefer copy-pasted transcripts over prose descriptions.
Include your verified python reference model inline in the note.
`

const GROUPS = [
  { key: 'seq-core', note: 'notes/seq-core.md', body:
    `Subcommand: seqtk seq -- part 1 of 2. Focus ONLY on these options and their interactions:
     -q INT (mask bases with quality lower than INT), -X INT (mask bases with quality higher than INT),
     -n CHAR (masked bases converted to CHAR; 0 for lowercase), -Q INT (quality shift),
     -V (shift quality by (-Q)-33), -F CHAR (fake FASTQ quality), -A (force FASTA), -x (convert all
     lowercase to -n), -U (uppercase), -S (strip white space in sequences), -M FILE (mask regions in
     BED or name-list file), -c (mask complement region).
     Nail down precisely: what "mask" means for each of the -n / -q / -X / -x / -M / -c combinations;
     what happens with -n when the char is '0' vs 'N' vs 'x' vs a digit like '5';
     how -Q interacts with -q/-X (is the comparison on raw ASCII or shifted?);
     exactly what -V outputs; whether -F takes a single char and how a multi-char arg behaves;
     what -M accepts (BED 3-col? 2-col? name list?) and whether coordinates are 0- or 1-based,
     half-open or closed, and what happens for out-of-range / reversed / overlapping intervals,
     and for a name-list line (whole sequence masked?).
     Also: does -A on FASTA input differ from no flag? Does masking apply to FASTA input (no qual)?
     Determine the ORDER in which transformations are applied (e.g. is -U applied before or after -x?).` },

  { key: 'seq-rest', note: 'notes/seq-rest.md', body:
    `Subcommand: seqtk seq -- part 2 of 2. Focus ONLY on these options and their interactions:
     -l INT (residues per line; 0 for 2^32-1), -L INT (drop sequences shorter than INT),
     -r (reverse complement), -R (output both forward and reverse complement),
     -C (drop comments), -N (drop sequences containing ambiguous bases), -1, -2 (output 2n-1 / 2n reads).
     Nail down: the exact line-folding behavior for FASTA and FASTQ (is quality folded too? what about
     -l 0? -l 1? negative -l?); whether an empty sequence still emits an empty line;
     the complete reverse-complement table for every ASCII byte you can feed it (build a single-record
     input containing all 256-ish printable bytes as the "sequence" and see what -r produces; also
     check whether quality is reversed); how -R names/emits the two copies; what counts as an
     "ambiguous base" for -N; how -1/-2 count records (before or after other filters like -L/-N?);
     whether -L compares < or <=; how -r interacts with -R and with -M masking.
     Also determine the default output line-wrapping for FASTA input that was already wrapped.` },

  { key: 'counts', note: 'notes/counts.md', body:
    `Subcommands: seqtk size, seqtk comp, seqtk gap, seqtk listhet, seqtk hpc.
     For comp: the header says columns are chr, length, #A, #C, #G, #T, #2, #3, #4, #CpG, #tv, #ts,
     #CpG-ts. Determine EXACTLY how each is computed. In particular figure out the classification of
     every IUPAC code into the #2/#3/#4 buckets, how #CpG is counted (evidence suggests 2 per CG
     dinucleotide - confirm and explain, including case-insensitivity and CG spanning line breaks),
     and what #tv/#ts/#CpG-ts count (they were 0 on plain ACGT input - find input that makes them
     non-zero; hint: they probably involve heterozygous IUPAC codes). Also characterize comp's
     -u flag and -r in.bed flag (what BED columns, output naming, coordinate base, does it print a
     line per region?). Does comp print the sequence name only or name+comment?
     For size: output format on FASTA vs FASTQ, and with 0 records.
     For gap: -l INT default 50; output BED-like format, coordinate base, what counts as a gap
     (only N/n? lowercase? other codes?), does it print anything for no gaps.
     For listhet: output format, what counts as a het, coordinate base, which column is what.
     For hpc: homopolymer compression - is it case sensitive? what about N runs?
     Does it keep quality (FASTQ input)? line wrapping? comments?` },

  { key: 'subseq', note: 'notes/subseq.md', body:
    `Subcommand: seqtk subseq (options -t, -s, -l INT). Determine:
     how it decides between BED mode and name-list mode (column count? per-line? whole file?);
     BED coordinate convention (0-based half-open?) and clamping of out-of-range coords;
     what happens for start>end, negative, beyond sequence end, a name not present in the input,
     duplicate names, a BED with >3 columns (is column 4 used as a name?);
     the output header format in each mode (does it append ":start-end"? what exact syntax?);
     whether comments are preserved; the -t TAB-delimited output columns exactly;
     -s strand aware (which column gives strand, what happens with '-', is quality reversed?);
     -l line length behavior and its default 0 meaning;
     FASTQ input behavior (does it output FASTQ with sliced quality?);
     the order of output records (input order or list order?);
     whether the name list may contain a name plus extra columns, and 2-column input handling;
     any error messages (e.g. malformed bed) and exit codes; behavior with empty list file.` },

  { key: 'fqchk', note: 'notes/fqchk.md', body:
    `Subcommand: seqtk fqchk [-q INT] <in.fq>. This prints a multi-line report. Determine the
     EXACT output: every header line, every column name, the exact number formatting for each
     column (how many decimal places, %.1f vs %.2f, rounding), the "ALL" row, per-position rows,
     and how the -q threshold changes the columns (%low and %high?). Work out precisely what each
     column means and how it is computed (average quality = mean of Q? error-rate weighted?).
     Determine what -q0 does. Test: FASTA input (no quality) - what happens? mixed-length reads;
     reads with quality below/above threshold; -q with negative or huge values; empty input.
     Build a python model that reproduces the exact bytes for >=50 random fastq files and report
     the diff result. Also determine the quality offset assumption (33?) and whether there is an
     option to change it.` },

  { key: 'pe-split', note: 'notes/pe-split.md', body:
    `Subcommands: seqtk mergepe, seqtk dropse, seqtk rename, seqtk split.
     mergepe: interleaving order, what happens when files have unequal record counts (error? silent
     truncation? exact message + exit code), FASTA vs FASTQ, mixed, whether names are modified.
     dropse: what makes two adjacent records a pair (name equality after stripping /1 /2 suffix?
     exact rule - test names like a/1,a/2 ; a.1,a.2 ; a,a ; a 1,a 2 ; a/1,b/2), output format,
     is comment used, is it strictly adjacent-pair based (streaming) or global?
     rename: default prefix when omitted, numbering scheme, does it keep comments, does it detect
     pairs (e.g. does /1 /2 get preserved and numbering shared between mates?), FASTQ output.
     split: -n INT files, -l INT line length, exact output filenames (prefix + what? extension .fa
     vs .fq?), which record goes to which file (round robin i%n?), what if n > record count (are
     empty files created?), what if prefix has a directory that does not exist (error text?),
     FASTA vs FASTQ output, and whether stdout gets anything.` },

  { key: 'trimfq', note: 'notes/trimfq.md', body:
    `Subcommand: seqtk trimfq (options -q FLOAT err-rate, -l INT, -b INT, -e INT, -L INT, -Q).
     The default mode uses a "Phred algorithm" for quality trimming. Reverse-engineer the exact
     algorithm: it is a dynamic-programming / max-sum scan over per-base error probabilities derived
     from quality values with a threshold. Determine the exact formula for the per-base score, the
     exact scan (from which end, ties, cumulative max), and how -l ("maximally trim down to INT bp")
     bounds the result. Design tiny inputs (e.g. quality strings with a single low-quality region)
     to pin the recurrence, then validate a python model on >=100 random fastq records - report the
     exact match rate and any unexplained case.
     Also: -b/-e (fixed trimming, and their interaction, and what happens when b+e >= length),
     -L (retain at most INT bp from 5'-end), -Q (force FASTQ output), FASTA input behavior,
     what the output looks like for a fully-trimmed-away read, and whether output is FASTA or FASTQ
     by default given FASTQ input.` },

  { key: 'hety-gc', note: 'notes/hety-gc.md', body:
    `Subcommands: seqtk hety (-w INT -t INT -m) and seqtk gc (-w -f FLOAT -l INT -x FLOAT).
     hety: determine the exact output columns and number formatting, how windows are laid out
     (start/step/last partial window), what counts as a het, what -t "# start positions in a window"
     means for the reported value, what -m does, and behavior when the sequence is shorter than
     the window. Derive an exact formula and validate a python model on random het-coded input.
     gc: this finds high-GC (or with -w high-AT) regions using an X-dropoff maximal-scoring-segment
     scan. Determine the exact scoring (what score for a GC base vs non-GC base given -f, is it
     f and f-1 or similar), the exact dropoff rule, whether regions are reported greedily and
     non-overlapping, the exact output format (BED? extra columns? coordinate base?), what -l
     filters, what non-ACGT/N bases score, and whether case matters. Validate a python model on
     random input covering many -f/-x/-l values; report exact-match rate.` },

  { key: 'fa-ops', note: 'notes/fa-ops.md', body:
    `Subcommands: seqtk mutfa, seqtk mergefa (-q INT -i -m -r -h), seqtk famask, seqtk randbase.
     mutfa: exact snp file format (columns), coordinate base, what column 3 is used for (any?),
     behavior for positions out of range, unknown chromosome, multiple mutations same position,
     unsorted input, output line wrapping and whether comments are kept, error text for malformed
     input.
     mergefa: merges two FASTA/Q. Work out the full merge rule: for each position given base a from
     file1 and base b from file2, what is output? Determine the IUPAC combination table by feeding
     all 16x16 combinations of IUPAC codes (build inputs programmatically) and tabulating the result.
     Determine how case (lowercase) is handled, what -q does when inputs are FASTQ (quality
     threshold -> what substitution?), what -i (intersection), -m (lowercase when one input is N),
     -h (suppress hets) do, and what happens when sequence names or lengths differ (exact error
     text + exit code). Output line wrapping.
     famask: apply an X-coded FASTA to a source FASTA - determine the exact substitution rule for
     every mask character (X, x, N, n, ACGT, other), name/length mismatch handling, output wrapping.
     randbase: choose a random base from hets - determine which codes are treated as het, and the
     output format. (Do NOT try to nail the RNG stream - another agent owns that - but DO record
     precisely how many random draws happen per het and per record, and the exact mapping from a
     random value to the chosen allele, e.g. r<0.5 picks the first IUPAC allele in some canonical
     order - state the order.)` },

  { key: 'cutn-telo', note: 'notes/cutn-telo.md', body:
    `Subcommands: seqtk cutN (-n INT -p INT -g) and seqtk telo (-m STR -p INT -d INT -s INT -P).
     cutN: splits sequence at long N tracts using a penalty scan. Derive the exact algorithm:
     score +1 (or +something) for N, -p for non-N, find maximal segments >= -n. Determine the exact
     output: with -g it prints gaps only (what format/coordinates?), without -g it prints the split
     sequences (what names? name:start-end? 1-based? wrapping? what happens to the leading/trailing
     N?). Validate a python model against >=50 random N-containing sequences over several -n/-p.
     telo: finds telomere repeats. Note "./executable telo -h </dev/null" SEGFAULTS - characterize
     when that happens exactly (which options trigger it; is it any unknown option? does a valid
     option avoid it?) and reproduce the exact stderr text before the crash and the exit status.
     Then derive telo's scoring algorithm: motif -m (default CCCTAA) matched on forward and
     reverse-complement, per-base score, penalty -p, max drop -d, min score -s. Determine the exact
     output columns (BED-like plus what?), the summary written to STDERR (README says
     "seqtk telo seq.fa > telo.bed 2> telo.count" - characterize that stderr line exactly), and what
     -P (print scoring) prints. Validate a python model on random sequences with planted telomere
     repeats; report exact-match rate.` },

  { key: 'rng', note: 'notes/rng.md', body:
    `THE PRNG. Several subcommands use a seeded pseudo-random generator: "seqtk sample [-2] [-s seed]
     <in.fa> <frac>|<number>", "seqtk seq -s INT -f FLOAT", "seqtk randbase", "seqtk mergefa -r".
     Your job is to recover the generator EXACTLY so it can be reimplemented bit-for-bit.

     Method suggestion: with "seqtk seq -s SEED -f FRAC in.fa" on a file of N single-base records,
     record i is kept iff (r_i < FRAC) for the i-th draw (verify whether it is < or <=, and whether
     a draw happens for every record). For each i you can BISECT on FRAC (using many digits, e.g.
     0.5, 0.75, ... down to 1e-12) to recover r_i to near machine precision. Recover r_0..r_40 for
     several seeds (0, 1, 11, 42, 12345, 2^31).
     Then identify the generator. Strong hypothesis to test FIRST: a 48-bit LCG of the drand48
     family, x <- (0x5DEECE66D * x + 0xB) mod 2^48, returning x / 2^48 (or ldexp(x, -48)), seeded
     either as x0 = (seed << 16) | 0x330E, or x0 = seed directly, or some other init. Test all
     plausible seedings and both "advance-then-return" orders against your recovered values, at full
     precision. Also test 64-bit variants (e.g. x <- 6364136223846793005*x + 1442695040888963407,
     return top 53 bits) and xorshift/wyhash/splitmix style generators.
     Do the arithmetic in python with exact integers. Do not guess - PROVE the match by predicting
     r_i for a seed you have not yet fitted, then confirming with the binary.

     Once identified, also determine:
     - Whether "seqtk sample" with a FRACTIONAL argument uses exactly the same draw-per-record rule
       (and the same seeding), and whether -2 (2-pass) changes which records are selected.
     - Whether "seqtk sample" with an INTEGER argument uses reservoir sampling, and the exact
       reservoir update rule (which index is replaced: floor(r*(i+1))? and is the draw made for
       every record or only after the reservoir is full?), plus the OUTPUT ORDER of the sampled
       records (input order, or reservoir slot order?).
     - How -2 two-pass mode differs (does it produce identical output to 1-pass for the same seed
       and integer count? for a fraction?).
     - Whether an integer-vs-fraction argument is decided by the presence of '.' or by value >= 1,
       and what happens for "0.0", "1", "1.0", "0", huge numbers, and non-numeric arguments.
     - How many draws randbase makes per het and the exact allele mapping (coordinate with the
       fa-ops note if helpful, but you own the RNG part).
     Write the recovered generator as python code in your note, plus a table of the first 10 doubles
     for seeds 0, 1, 11, 42.` },
]

phase('Probe')
const results = await pipeline(
  GROUPS,
  g => agent(`${RULES}\n\nWRITE YOUR NOTE TO: /workspace/${g.note}\n\n${g.body}\n\nWhen done, reply with a <=200 word summary: what you nailed down with certainty, and an explicit list of anything still uncertain or unexplained.`,
    { label: `probe:${g.key}`, phase: 'Probe' }),
  (summary, g) => agent(
    `${RULES}\n\nA previous agent characterized the following and wrote /workspace/${g.note}:\n${g.body}\n\nTheir summary:\n${summary}\n\nYOU ARE THE COMPLETENESS CRITIC. Read /workspace/${g.note}. Then, by RUNNING /workspace/executable yourself, hunt for:
 (a) claims in the note that are WRONG (test them),
 (b) behaviors/options/edge cases the note does not cover,
 (c) missing exact formatting details (spacing, decimals, newlines, exit codes, stderr vs stdout).
Fix and extend the note file directly (edit it in place; keep it well organized). Do not remove correct content.
Reply with a <=200 word list of the corrections and additions you made, and anything still unknown.`,
    { label: `critic:${g.key}`, phase: 'Critique' })
)
return { done: GROUPS.map(g => g.key), critiques: results }
