export const meta = {
  name: 'fasttext-explore',
  description: 'Exhaustively probe the fastText reference binary behavior across all subcommands and write findings files',
  phases: [
    { title: 'Probe', detail: 'parallel behavioral probes of each surface area' },
    { title: 'Verify', detail: 'adversarial re-check of each findings file' },
  ],
}

const PREAMBLE = `
You are reverse-engineering a compiled binary for a clean-room reimplementation benchmark.

REFERENCE BINARY: /workspace/executable  (it is fastText's CLI, version with model file format version 12)
WORKDIR: use /tmp/ft (already contains test data: tiny.txt, sup.txt, uns.txt, big_sup.txt, big_uns.txt).
There is a python model parser at /tmp/ft/tools/parse.py (parse(path) -> (dict, reader)).

HARD RULES (violating them fails the whole benchmark):
- You MUST NOT search the web, clone repos, use pip/apt/cargo/go to fetch the project, or read any fastText source code.
- You MUST NOT run objdump/gdb/ghidra/strace/ltrace/nm/readelf/strings on /workspace/executable, and must not decompile it.
- You may ONLY run /workspace/executable with CLI args / stdin and observe stdout, stderr, exit codes, and files it writes.
- You MAY freely inspect files the binary WRITES (model .bin/.vec/.ftz) with od/python.

ALREADY KNOWN (do not re-derive, build on it):
- Model .bin layout: int32 magic 793712314, int32 version 12, then args:
  dim,ws,epoch,minCount,neg,wordNgrams (int32 each), loss(int32: 1=hs,2=ns,3=softmax,4=ova),
  model(int32: 1=cbow,2=sg,3=sup), bucket,minn,maxn,lrUpdateRate (int32 each), t (double).
  Then dict: size_(i32), nwords_(i32), nlabels_(i32), ntokens_(i64), pruneidx_size_(i64),
  then size_ entries of {NUL-terminated string, count i64, type u8 (0=word,1=label)},
  then if pruneidx_size_>0: that many pairs of (i32,i32).
  Then bool quant_ (1 byte), then input matrix, then bool qout (1 byte), then output matrix.
  A dense matrix is: m_(i64), n_(i64), then m*n float32.
- Input matrix random init: blockSize = (m*n)/10 (integer div!); for blockId in [0, args.thread):
  std::minstd_rand rng(seed+blockId); std::uniform_real_distribution<double> u(-1.0/dim, 1.0/dim);
  fill data[blockId*blockSize .. min((blockId+1)*blockSize, m*n)) — the REST IS LEFT UNINITIALIZED
  (use env MALLOC_PERTURB_=42 to make uninitialized bytes show up as 0xd5d5d5d5 so you can tell them apart).
  Output matrix is zero-filled.
- Because of the uninitialized memory, training with -thread < 10 is NONDETERMINISTIC and may abort with
  "terminate called after throwing an instance of 'fasttext::DenseMatrix::EncounteredNaNError'".
  Use -thread 12 (or >=10) for deterministic/valid runs, or -lr 0 to freeze weights.

WRITE YOUR FINDINGS to the exact file path given below, in markdown. Be extremely precise and concrete:
exact byte offsets, exact printf-style format strings (spacing matters!), exact wording of every message,
exit codes, and small reproducible examples with their literal observed output. Where you infer a formula,
state the evidence. Prefer tables of (input -> observed output). Include enough that someone can
reimplement WITHOUT access to the binary. Do not summarize away details.

Your final returned text must be a SHORT (<=15 line) summary; the real deliverable is the file.
`

const PROBES = [
  {
    key: 'dict',
    file: '/tmp/ft/findings/01-dictionary.md',
    task: `Reverse-engineer the DICTIONARY construction exactly.
Determine and document:
1. Tokenization: exactly which characters separate tokens. Test space, tab, \\n, \\v, \\f, \\r, \\0, other control chars, unicode. How is end-of-line represented (the </s> token)? Does </s> get counted in ntokens? What happens with an extremely long token (is there a max token length / truncation)?
2. Word ordering in the saved dict: build inputs where you control counts, then read the saved dict order via 'dump <model> dict' and by parsing the .bin. Determine the sort key (count desc? type first? tie-breaking by string?) and whether </s> is always index 0.
3. minCount / minCountLabel pruning: exactly when are words dropped; is it > or >=; is ntokens_ affected; is </s> exempt? Does the threshold interact with the initial hash-table growth/pruning (there is a max vocabulary size ~30000000 and an internal pruning that raises minCount when the hash table gets too full — try to detect its existence with a synthetic huge-vocab file if feasible, else say so).
4. The label prefix: -label option, words starting with the prefix become labels. What if a token is exactly the prefix? What if -label is empty string? Are labels also subject to subword ngrams?
5. 'dump <model> dict' output format: exact columns/separators for words and labels.
6. Determine the WORD HASH function. Evidence path: build a supervised model with -wordNgrams 2 -bucket B and print-ngrams / dump to observe bucket indices; or better, use 'print-word-vectors' on OOV words with char ngrams and compare to 'print-ngrams'. State clearly what you can prove. A very likely candidate is FNV-1a variant: h=2166136261; for each byte c: h = (h ^ (uint8)c) * 16777619 (uint32). Design an experiment that CONFIRMS OR REFUTES it (e.g. train with -bucket 2 or -bucket 3 and -minn 1 -maxn 1 and see which ngrams collide, or use print-ngrams output ordering).
Report exact experiments and results.`,
  },
  {
    key: 'subword',
    file: '/tmp/ft/findings/02-subwords-and-ngrams.md',
    task: `Reverse-engineer SUBWORD char n-grams and WORD n-grams.
1. 'print-ngrams <model> <word>': exact output format (does it print the ngram string then the vector? separators? trailing space? order?). Which ngrams are produced for a word given -minn/-maxn: is the word wrapped in '<' and '>'? Is the whole word '<word>' included as an ngram? Is the word itself (as a dictionary entry) included in the list? Verify with multi-byte UTF-8 (e.g. 'héllo', emoji): ngrams must be split on UTF-8 character boundaries — confirm.
2. Determine the bucket index formula for a char ngram: likely nwords + (hash(ngram) % bucket). Prove it by training with tiny -bucket values and comparing print-ngrams vectors to dump input rows (with -lr 0 so weights are just the deterministic init and use -thread 12 so everything is initialized).
3. Word n-grams (-wordNgrams>1): determine how the ngram hash is computed from word hashes (candidate: h = words[i]; for j: h = h * 116049371 + words[j]; then bucket = nwords + h % bucket). Prove/disprove with experiments comparing predictions/vectors. Note bucket is forced to 0 when wordNgrams<=1 for supervised — verify exactly when bucket is zeroed.
4. Are labels excluded from ngram generation? Is </s> given subword ngrams?
5. What are the model sizes (input matrix rows) in each case: nwords+bucket?
Give exact reproducible experiments with numbers.`,
  },
  {
    key: 'train-output',
    file: '/tmp/ft/findings/03-training-output.md',
    task: `Reverse-engineer the exact TRAINING PROGRESS / LOG output (stderr) byte for byte.
1. Capture with 'cat -A' the exact bytes of: the "Read %dM words" line (with \\r), "Number of words:", "Number of labels:", and the progress lines. Determine the exact printf format: field widths, decimal places, use of \\r vs \\n, trailing spaces, and the final newline / flush behavior.
2. Progress line: 'Progress: xxx.x% words/sec/thread: %9d lr: %9f avg.loss: %9f ETA: %3dh%2dm%2ds' — determine the EXACT widths and separators by testing values that vary in magnitude (large corpora so ETA is nonzero, tiny corpora, lr big/small). Use a slow run (many epochs, big dim) to capture intermediate progress lines.
3. -verbose levels: 0,1,2,3 — what is printed at each? Which lines disappear?
4. What is printed at the very end after training (e.g. nothing? a final newline?). Is 'Progress: 100.0%' always printed?
5. Behavior when the input file has a huge number of tokens: the "Read %dM words" counter — is it printed every 1M tokens with \\r? Verify the threshold.
6. Determine the exit code on success and on the various failures.
7. Also document what train prints for skipgram/cbow vs supervised (any differences).
8. Does it print anything to stdout during training?`,
  },
  {
    key: 'predict-test',
    file: '/tmp/ft/findings/04-predict-test.md',
    task: `Reverse-engineer 'predict', 'predict-prob', 'test', 'test-label' EXACTLY.
Train a usable supervised model first (use -thread 12 -epoch 5 on /tmp/ft/big_sup.txt or sup.txt; make sure it doesn't NaN — retry if needed; save it to /tmp/ft/shared_sup.bin and also copy to /tmp/ft/findings/ if small).
Document:
1. predict output: one line per input line; how are multiple labels separated; what if no label passes threshold (empty line?); is the label printed raw (with __label__ prefix)? Exact float format for predict-prob (printf %g? how many digits? scientific?). Test probabilities near 1 and tiny.
2. Behavior on empty input lines, lines with only unknown words, lines with labels included in the test data.
3. 'test' output: exact lines 'N\\t...' — capture with cat -A. What is printed: N, P@k, R@k, and is there anything else? Exact number formatting (%.3g? %.3f?). Behavior with k>1 and threshold.
4. 'test-label' output: exact per-label lines format (F1-Score, Precision, Recall, FPR?), ordering of labels, and any trailing summary lines (e.g. 'N\\t...', micro/macro averages). Capture with cat -A.
5. '-' as test-data reads stdin: verify for test/predict. What about test-label?
6. Exit codes and error messages for: missing model file, corrupt model file, missing test file, k=0, negative k, non-numeric k, threshold out of range.
7. Does predict work with a model trained by skipgram/cbow (error message)?
8. Are probabilities computed as exp(score)? For predict (not -prob) is anything numeric printed?`,
  },
  {
    key: 'printvec',
    file: '/tmp/ft/findings/05-print-vectors-nn-analogies.md',
    task: `Reverse-engineer 'print-word-vectors', 'print-sentence-vectors', 'nn', 'analogies'.
1. print-word-vectors: reads words from stdin one per line? or splits each line into words? Exact output format: 'word v1 v2 ... vN' — number formatting (%g with 5 significant digits?), separators, trailing space before newline? Test OOV words (with and without subwords), empty lines, lines with multiple words, leading/trailing spaces.
2. print-sentence-vectors: how is the sentence vector computed (average of word vectors, normalized?) — design experiments (e.g. a 1-word sentence vs the word vector; a 2-word sentence vs the average) to determine the exact formula including whether </s> is included and whether each word vector is L2-normalized before averaging and whether the divisor is the number of tokens. Exact output format.
3. nn: interactive. It prints a "Query word? " prompt? Capture exact prompt bytes and where they go (stdout/stderr). Output format for each neighbor: 'word score'? How many decimals? Is the query word excluded? Is cosine similarity used? What about OOV query words? What happens on EOF? Does it print a banner first? Test with piped stdin.
4. analogies: prompt text ('Query triplet (A - B + C)? '), how many words read per line, output format, exclusions (are A,B,C excluded from results?).
5. For nn/analogies, does the <k> arg work, and what if k > vocab size?
6. The .vec text file format written after training: exact header and per-line formatting (capture with cat -A), number of significant digits.
Give literal captured outputs.`,
  },
  {
    key: 'quantize',
    file: '/tmp/ft/findings/06-quantize.md',
    task: `Reverse-engineer the 'quantize' command and the .ftz file format.
1. CLI: which args are required/optional; what does '-input' do for quantize (needed only with -retrain/-cutoff?); what does -output mean (reads <output>.bin and writes <output>.ftz?). Try 'quantize -output model' with and without -input. Document error messages exactly.
2. Produce .ftz files with various -dsub, -cutoff, -qnorm, -qout and reverse-engineer the BYTE LAYOUT of the quantized matrix section. Expected pieces: after the dict there is bool quant_=1, then a QuantMatrix serialization. Work out the exact field order/sizes by diffing files produced with different dsub/qnorm and by changing dim. Candidate layout: qnorm_(bool), m_(i64), n_(i64), codesize_(i32)?, codes bytes, then the PQ codebook: dim_(i32), nsubq_(i32), dsub_(i32), lastdsub_(i32), centroids float32[...]. Determine the true order and sizes empirically (write a parser and validate it round-trips to exactly the file length for many parameter combos).
3. Determine how many centroids (k) are used (likely 256) and the sub-vector dimension handling when dim is not divisible by dsub.
4. Verify that a .ftz model can be used with test/predict and what error appears if you try to keep training it.
5. Document what quantize prints to stderr/stdout and its exit code.
6. Determine what -cutoff does to the dictionary (pruneidx_size_ > 0 case) — produce a model with -cutoff and document the resulting dict/pruneidx contents and how nwords/bucket change.
Deliver a fully specified byte layout with a validated parser (include the parser code in the file).`,
  },
  {
    key: 'args-errors',
    file: '/tmp/ft/findings/07-args-and-errors.md',
    task: `Reverse-engineer ARGUMENT PARSING and ALL ERROR MESSAGES exactly.
1. For every flag in the help text, test: unknown flag, flag with missing value, non-numeric value where a number is expected, negative values, out-of-range values. Capture exact stderr text and exit code for each.
2. Test unknown command, no command, '-h', '--help', 'help'.
3. Test -loss with an invalid name; -input pointing to a missing file / a directory; -output in a non-writable directory; -pretrainedVectors missing/malformed.
4. Determine which defaults change per command (supervised vs skipgram vs cbow vs quantize) — build a complete table by running each command with no args and diffing (already partly known: supervised => minCount 1, minn 0, maxn 0, lr 0.1, loss softmax; others => minCount 5, minn 3, maxn 6, lr 0.05, loss ns). Also check: does 'supervised' force -wordNgrams? Does bucket get zeroed when wordNgrams==1? Does -loss ova/one-vs-all both parse?
5. Determine the exact help text printed for each error case (is it the full help, or just a line?). Note that 'supervised'/'skipgram'/'cbow' with no args print "Empty input or output path." followed by the full help; determine whether that full help goes to stderr and its exact bytes (diff against the other commands' help).
6. Check how the parser handles: args after '--', repeated flags, '-input=file' (equals form), flags without leading dash, extra positional args.
7. Check the special case in the arg parser for '-verbose' or others being handled before the loop.
8. Document precisely what happens with '-dim 0', '-thread 0', '-epoch 0', '-bucket 0', '-minn 5 -maxn 3', '-neg 0', '-ws 0', '-t 0'.
Deliver a table: command line -> exact stderr (quoted) -> exit code.`,
  },
  {
    key: 'dump-pretrained',
    file: '/tmp/ft/findings/08-dump-pretrained-saveoutput.md',
    task: `Reverse-engineer 'dump', -pretrainedVectors, -saveOutput, and the .vec/.bin outputs.
1. 'dump <model> args': exact list and order of printed args, exact formatting of each (esp. floats like t). Compare against a model trained with unusual values. Does it print lr/thread/epoch? Which args are NOT stored in the .bin?
2. 'dump <model> dict': exact format per line (word count type?) and ordering.
3. 'dump <model> input' and 'dump <model> output': exact header line and number formatting (how many significant digits, separators, trailing space?). What happens for quantized models?
4. 'dump' with an invalid option: exact error.
5. -pretrainedVectors: create a .vec file by hand and load it. Determine: required header format, error messages for dimension mismatch / malformed lines / missing file, whether words not in the pretrained file are randomly initialized, whether the dictionary is built from the training data or from the vectors file, and how the input matrix rows are ordered. Test with supervised and with skipgram.
6. -saveOutput true: what extra file is written (<output>.output?) and in what format (like .vec?). Capture exact bytes of the first lines.
7. After training, which files are always written (.bin and .vec)? Is .vec written for supervised too? Is the .vec written before or after .bin (check with a read-only dir trick or timestamps)?
8. Verify the .vec ordering equals the dictionary order and it contains only words (not labels), count = nwords.`,
  },
  {
    key: 'training-algo',
    file: '/tmp/ft/findings/09-training-algorithm.md',
    task: `Reverse-engineer the TRAINING ALGORITHM numerics well enough to reproduce bit-exact results.
Use -thread 12 (so the input matrix is fully initialized => deterministic) plus a small corpus, and -epoch 1.
1. Verify determinism: run the same command twice with -thread 12 and compare md5 of the .bin. If not deterministic, find a configuration that IS (note: with N threads the corpus is split into N contiguous byte ranges; with 1 thread it is deterministic except for the uninit-memory issue — you can dodge that by choosing dim/vocab so that (m*n)/10*thread >= m*n, i.e. thread>=10).
2. Determine the learning-rate schedule: lr = lr0 * (1 - progress) where progress = tokenCount/(epoch*ntokens); updated every lrUpdateRate tokens. Verify by reading the printed lr at known progress.
3. Determine the subsampling/discard rule for unsupervised models: p_discard = 1 - (sqrt(t/f) + t/f) where f = count/ntokens; sampled with a per-thread rng. Determine the RNG type and seeding (candidate: std::minstd_rand rng(threadId) or seeded with args.seed+threadId). Design an experiment: set -t huge (e.g. 1) or -t 0 to disable, and compare token counts / results.
4. Determine the negative sampling table: size 10000000, built from counts^0.5, and the rng used to draw negatives. Also determine how negatives that equal the target are handled (redraw or skip).
5. Determine the hierarchical softmax tree construction (Huffman) and the resulting codes: verify via a tiny model with known counts by checking which output rows get updated (train with -lr big and look at which rows of the output matrix become nonzero).
6. skipgram/cbow: the random window size (uniform in [1, ws]) and the rng used; whether the center word is included; whether cbow averages (divides by number of context words).
7. Sentence/line reading: max line length (MAX_LINE_SIZE=1024?) — test a very long line and see whether it is split.
8. Give a precise pseudocode of the training loop you can defend with evidence.`,
  },
  {
    key: 'autotune',
    file: '/tmp/ft/findings/10-autotune.md',
    task: `Reverse-engineer the AUTOTUNE feature (-autotune-validation etc.).
1. Run 'supervised -input <train> -output m -autotune-validation <valid> -autotune-duration 10' and capture the EXACT stderr output format (progress lines, trial counters, best score reporting). Use cat -A.
2. Determine which hyperparameters are searched and their ranges if observable (e.g. by running with -autotune-duration 30 and inspecting the args of the produced model with 'dump m.bin args' across several runs).
3. -autotune-metric: test 'f1', 'f1:labelname', 'precisionAtRecall:30', 'recallAtPrecision:30', invalid values -> exact error messages.
4. -autotune-modelsize: test values like '2M', '10K', '1000', invalid -> exact error messages. Does it produce a .ftz?
5. What happens if -autotune-validation file is missing?
6. Is the final model saved to <output>.bin? Is a .vec written?
7. Document the exact wording of every message.
Be thorough but keep total runtime bounded (use -autotune-duration 5..20).`,
  },
  {
    key: 'misc-edge',
    file: '/tmp/ft/findings/11-misc-edge-cases.md',
    task: `Probe MISCELLANEOUS edge cases of /workspace/executable.
1. Empty input file; file with only blank lines; file with one word; file where every word is below minCount (what error? 'Empty vocabulary. Try a smaller -minCount value.'?). Capture exact text + exit code.
2. Supervised training data with no labels at all -> exact error message.
3. A line with a label but no words. A line with only labels.
4. Reading a model file that is: empty, truncated, has a bad magic, has an older version number. Capture exact error text (e.g. 'has wrong file format!'). Determine how the version/magic check message reads.
5. Loading a .ftz with commands that require a full model.
6. print-word-vectors / nn on a supervised model with no subwords (OOV word -> zero vector?).
7. Behaviour when -input is the same as -output prefix.
8. Very large -bucket / -dim (allocation failure message?). Skip if it would OOM the box (125GB RAM, be careful, do not use more than ~8GB).
9. UTF-8 and binary garbage in the training file.
10. What happens when the output path directory does not exist -> exact error.
11. Signals/EOF handling for interactive commands.
12. Check 'test' with a test file containing lines with no labels.
Give a table of case -> exact output -> exit code.`,
  },
]

phase('Probe')
const probeResults = await parallel(PROBES.map(p => () =>
  agent(`${PREAMBLE}\n\nOUTPUT FILE: ${p.file}\n\nTASK:\n${p.task}`, {
    label: `probe:${p.key}`,
    phase: 'Probe',
  })
))

phase('Verify')
const verifyResults = await parallel(PROBES.map((p, i) => () =>
  agent(`${PREAMBLE}\n\nA previous agent wrote findings to ${p.file}.
Your job: ADVERSARIALLY VERIFY it. Read the file, then re-run the key experiments yourself against /workspace/executable.
For every claim that is wrong, imprecise, or unproven, FIX THE FILE IN PLACE (edit it) and add a "## Verification notes" section
at the end listing what you corrected and what remains uncertain. Pay special attention to exact output formatting
(spacing, decimals, tabs, \\r vs \\n) — re-capture with cat -A and paste literal bytes.
Also fill in any of the original task's questions the previous agent skipped:\n${p.task}\n
Return a SHORT summary of corrections made.`, {
    label: `verify:${p.key}`,
    phase: 'Verify',
  })
))

return { probes: PROBES.map(p => p.file), n: probeResults.filter(Boolean).length, verified: verifyResults.filter(Boolean).length }
