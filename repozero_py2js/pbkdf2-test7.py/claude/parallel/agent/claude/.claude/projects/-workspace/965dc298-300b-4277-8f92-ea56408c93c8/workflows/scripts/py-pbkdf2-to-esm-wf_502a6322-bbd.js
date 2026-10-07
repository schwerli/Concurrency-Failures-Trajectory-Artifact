export const meta = {
  name: 'py-pbkdf2-to-esm',
  description: 'Port Python pbkdf2 test7.py to zero-dependency Node ESM, then fuzz + adversarially verify against the executable',
  phases: [
    { title: 'Recon', detail: 'nail down argparse precedence + encoding edge cases from the executable' },
    { title: 'Implement', detail: 'write the .mjs module hierarchy in /output' },
    { title: 'Fuzz', detail: 'differential test batteries vs test7_executable across input classes' },
    { title: 'Review', detail: 'adversarial reviewers: compliance, argparse fidelity, SHA1/HMAC edges, formatting' },
    { title: 'Fix', detail: 'apply confirmed findings and re-verify' },
    { title: 'Final', detail: 'independent clean-room acceptance run' },
  ],
}

const SPEC = `
## Established ground truth (do NOT re-derive; already verified against the executable + openssl twice)

Source: /workspace/dataset/pbkdf2/test7.py (listing below). Reference binary: /workspace/dataset/test7_executable
(run it directly; NEVER run \`python\`).

\`\`\`python
#!/usr/bin/env python3
import argparse
import pbkdf2

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=str, required=True)  # passphrase
parser.add_argument('--b', type=str, required=True)  # salt1
parser.add_argument('--c', type=str, required=True)  # salt2
args = parser.parse_args()

key1 = pbkdf2.PBKDF2(args.a, args.b).read(24)
print(key1.hex())

key2 = pbkdf2.PBKDF2(args.a, args.c).read(24)
print(key2.hex())
\`\`\`

The \`pbkdf2\` PyPI package (Dwayne Litzenberger) \`PBKDF2(passphrase, salt)\` defaults resolve to:
  * PRF = HMAC-SHA1, iterations = 1000, dkLen here = 24 bytes.
  * passphrase and salt are str -> encoded **UTF-8** to bytes.
  * \`.read(n)\` is a *keystream* read: it yields n bytes, concatenating derived blocks
    T_1 || T_2 || ... (SHA-1 => 20 bytes per block) and buffering the remainder for
    subsequent \`.read()\` calls. 24 bytes = T_1 (20 bytes) + first 4 bytes of T_2.
  * PBKDF2 (RFC 2898): T_i = U_1 ^ U_2 ^ ... ^ U_c, U_1 = PRF(P, S || INT32_BE(i)),
    U_j = PRF(P, U_{j-1}); block counter i starts at 1.
  * Output printed via Python \`bytes.hex()\` -> lowercase hex, no separators, then a newline.

Confirmed observed behaviour of the executable:
  * \`--a 'Lm8qH}*x' --b 'salt_346554' --c 'Ad32jimv'\`
    -> \`cf8a3a32ff637b7965a1c8b2b9cfaf3f283fba55428bf49d\` / \`b36aa0de2cd1534e26a3f16c005879ab998e9343173a50f8\`, rc 0
  * empty strings for all three: allowed, rc 0, both lines \`6e40910ac02ec89cebb9d898b13a09d1cd7adf6f8cc08cc4\`
  * unicode \`--a 'pä密码🔑' --b 'sält€' --c '盐2'\`
    -> \`42c829dbb5a732aeaf50c7bb0ed41b98e361c0906cfa3e74\` / \`201445efb5999eb98880fd004fd52d0a3e69b8b751616855\`
  * \`--a=abc\` equals-form works; a repeated \`--a\` -> last occurrence wins.
  * usage line: \`usage: test7_executable [-h] --a A --b B --c C\` (prog = basename of argv[0];
    for our port that means basename(process.argv[1]), i.e. \`test7.mjs\`).
  * missing required -> stderr usage line + \`<prog>: error: the following arguments are required: --a, --b, --c\`
    (only the missing ones, in declaration order, comma+space separated), exit code 2.
  * unknown option -> \`<prog>: error: unrecognized arguments: --d 4\`, exit 2.
  * option with no value -> \`<prog>: error: argument --a: expected one argument\`, exit 2.
  * \`--help\` -> stdout, exit 0:
\`\`\`
usage: test7_executable [-h] --a A --b B --c C

options:
  -h, --help  show this help message and exit
  --a A
  --b B
  --c C
\`\`\`

## Hard requirements (violations invalidate the answer)

1. Pure JavaScript on Node.js. **ESM only**: \`import\` / \`export\`. \`require()\` and
   \`module.exports\` are strictly prohibited anywhere.
2. Every generated file uses the **.mjs** suffix, and every relative import includes the
   full \`.mjs\` extension.
3. **Zero external dependencies.** No npm packages. Only relative local-file imports are
   allowed in \`import\` statements.
4. **\`node:crypto\` must not be imported, referenced, or mentioned at all** — not in code,
   not in comments, not in strings. In particular the task forbids
   any pbkdf2 interface of that module. SHA-1 and HMAC must be implemented from scratch in
   pure JS. Do not import any other node builtin unless genuinely needed
   (\`node:path\`/\`node:process\` are acceptable; prefer globals \`process\`/\`Buffer\` or pure JS).
   Do not shell out. Do not embed Python.
5. No Python embedding/spawning of any kind.
6. All generated code lives under \`/output\`. Entry file is exactly \`/output/test7.mjs\`.
7. Hierarchical library split, each module exposing its interface via \`export\`.

## Required module layout (follow exactly)

  /output/lib/bytes.mjs    - byte/encoding primitives: UTF-8 encode, lowercase hex format,
                             fixed-width big-endian int packing, XOR, concat/slice helpers.
                             Use Uint8Array as the internal byte type.
  /output/lib/sha1.mjs     - pure-JS SHA-1: exports digest-module-shaped interface
                             ({ digestSize: 20, blockSize: 64, new()/update()/digest(),
                             and a one-shot helper }) so HMAC can stay algorithm-agnostic.
  /output/lib/hmac.mjs     - generic HMAC (RFC 2104) parameterised over an injected digest
                             module, mirroring the Python macmodule/digestmodule seam.
  /output/lib/pbkdf2.mjs   - PBKDF2 class mirroring the Python API surface:
                             constructor(passphrase, salt, iterations = 1000, digestmodule = SHA1),
                             stateful \`read(n)\` keystream with internal buffer + block counter,
                             plus \`close()\`/\`hexread(n)\` analogues. Accepts str (UTF-8 encoded)
                             or raw byte input.
  /output/lib/argparse.mjs - minimal argparse-compatible parser reproducing the usage string,
                             help text, error messages, and exit codes documented above.
  /output/test7.mjs        - entry point: parses argv, derives both keys, prints two hex lines.

Keep the code idiomatic, commented at a normal density, and readable. SHA-1 must handle
arbitrary-length input correctly (multi-block, all padding boundary cases at 55/56/63/64/119/120
bytes, and the 64-bit big-endian bit-length field). HMAC must hash keys longer than 64 bytes
and zero-pad shorter ones.
`;

phase('Recon')
const RECON = [
  {
    key: 'argparse-precedence',
    prompt: `Probe /workspace/dataset/test7_executable ONLY (never run \`python\`) to pin down argparse error precedence and edge cases. Determine, by running it:
1. With BOTH an unrecognized option AND missing required options (e.g. \`--a 1 --d 4\`), which error wins and what is the exact stderr text?
2. \`--a --b\` (option value that looks like an option) — exact error text? What about \`--a -1\` and \`--a=-1\` and \`--a ''\`?
3. Does a negative-number-looking or dash-leading value get accepted positionally? What is the exact text for a bare positional, e.g. \`--a 1 --b 2 --c 3 extra\`?
4. Abbreviation/prefix behaviour: does \`--a\` have any ambiguity? Try \`-a 1 -b 2 -c 3\` (single dash) and \`--A 1\`.
5. \`-h\` alone; \`-h\` combined with valid args; \`--help\` combined with a missing required arg — exit codes and which stream.
6. Anything after a literal \`--\` separator.
Report exact stdout, exact stderr (byte-for-byte, note trailing newlines), and exit code for every probe as a compact table. Facts only — no speculation. This is pure recon: do NOT write or edit any files.`,
  },
  {
    key: 'encoding-edges',
    prompt: `Probe /workspace/dataset/test7_executable ONLY (never run \`python\`) for input-encoding edge cases of the PBKDF2 derivation. It computes PBKDF2-HMAC-SHA1(passphrase=--a, salt, 1000 iters, 24 bytes) printed as lowercase hex, twice (salt=--b then salt=--c). Verify by running the binary:
1. Non-ASCII confirms UTF-8: pass \`--a 'é'\` (2 UTF-8 bytes) vs \`--a 'Ã©'\` (the latin-1 mojibake, 3 bytes) — record both outputs and confirm they differ, proving no latin-1 round-trip.
2. A 4-byte astral char (e.g. '🔑') and a lone-ish combining sequence — record outputs.
3. Passphrase exactly 63, 64, 65 bytes long (HMAC key padding vs key-hashing boundary): use ASCII 'A' repeats. Record outputs.
4. Salt of length 0, 1, 19, 20, 21, 64, 200. Record outputs.
5. Embedded tab/newline in a value (use $'a\\tb' and $'a\\nb' bash quoting). Record outputs.
6. Whether swapping --b and --c just swaps the two output lines (sanity: derivation depends only on (pass, salt)).
Report a compact table of exact argv -> exact two output lines + exit code. These become differential test vectors, so be precise and note the exact bash quoting used. Pure recon: do NOT write or edit any files.`,
  },
]

const recon = await parallel(RECON.map(r => () =>
  agent(r.prompt, { label: `recon:${r.key}`, phase: 'Recon' })))

const reconNotes = RECON.map((r, i) => `### Recon: ${r.key}\n${recon[i] ?? '(recon failed — probe it yourself before relying on any assumption)'}`).join('\n\n')

phase('Implement')
const implNotes = await agent(
`You are porting a Python script to zero-dependency Node.js ESM. Write the complete implementation now.

${SPEC}

## Additional verified recon from the reference binary
${reconNotes}

## Your job
Create every file of the module layout under /output (create directories as needed). Then self-verify:
  * Run \`node /output/test7.mjs --a 'Lm8qH}*x' --b 'salt_346554' --c 'Ad32jimv'\` and diff against
    \`/workspace/dataset/test7_executable\` with the same args — stdout, stderr and exit code must match exactly.
  * Do the same for all four sample cases in the source listing, the empty-string case, the unicode case,
    and every recon vector above (including the error/help cases and their exit codes).
  * Sanity-check your SHA-1 against known vectors: sha1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709,
    sha1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d,
    sha1("a"*1000000) = 34aa973cd4c4daa4f61eeb2bdbad27316534016f.
    Also check HMAC-SHA1 RFC 2202 vector: key=0x0b*20, data="Hi There" -> b617318655057264e28bc0b6fb378c8ef146be00.
  * Verify the \`read()\` keystream semantics: two successive \`read(12)\` calls on one PBKDF2 instance must
    concatenate to the same 24 bytes as a single \`read(24)\`.
Iterate until everything matches. Use a scratch dir like /tmp for any throwaway test harness — do not leave
test scaffolding inside /output.

Return a concise report: the file tree you created, one line per module on its responsibility, the exact
verification commands you ran with pass/fail, and any behaviour where you deliberately diverged from the
reference (with justification).`,
  { label: 'implement', phase: 'Implement', effort: 'high' })

phase('Fuzz')
const FUZZ_CLASSES = [
  { key: 'ascii-random', desc: 'random printable-ASCII passphrases and salts of many lengths (1-300), including the punctuation-heavy style of the sample cases ("Lm8qH}*x", "salt_NNNNNN"). At least 60 cases.' },
  { key: 'unicode', desc: 'multi-byte UTF-8: CJK, accented latin, Greek/Cyrillic, emoji incl. astral + ZWJ sequences, combining marks, and mixed ASCII/non-ASCII. At least 50 cases. Be careful that your harness passes identical bytes to both programs.' },
  { key: 'boundaries', desc: 'length boundary sweep: passphrase and salt lengths hitting 0,1,2,19,20,21,31,32,54,55,56,57,63,64,65,111,112,119,120,127,128,200,1000 in a cross-product sample. These stress SHA-1 padding and the HMAC key>blocksize path. At least 60 cases.' },
  { key: 'hostile-chars', desc: 'whitespace-only, tabs, newlines, CR, NUL-adjacent-safe control chars, leading/trailing spaces, values that look like options ("--x", "-5"), quotes, backslashes, %s, $(...), and empty strings in every position. At least 40 cases. Use an argv-array spawn API (no shell string interpolation) so quoting cannot corrupt the comparison.' },
  { key: 'cli-semantics', desc: 'CLI-level equivalence rather than crypto: missing/duplicated/unknown/abbreviated options, --help, -h, equals-form vs space-form, "--" separator, extra positionals, option-with-no-value, and every ordering permutation of the three required options. Compare stdout, stderr and exit code exactly. Remember prog name differs by design (test7.mjs vs test7_executable); treat ONLY that substring as an allowed difference and say so explicitly in your report. At least 30 cases.' },
]

const fuzzResults = await pipeline(
  FUZZ_CLASSES,
  c => agent(
`Differential-test a Node.js port against its Python reference binary.

Reference: \`/workspace/dataset/test7_executable\`  (run it directly; NEVER run \`python\`)
Port under test: \`node /output/test7.mjs\`
Both take \`--a <passphrase> --b <salt1> --c <salt2>\` and print two 48-char lowercase-hex lines.

Write a throwaway harness in /tmp (a .mjs script using child_process spawnSync with an argv ARRAY, or a
bash script using proper quoting) that runs both programs on identical argv and compares stdout, stderr and
exit code byte-for-byte. Do NOT create or modify anything under /output — you are a tester, not an author.

Your assigned input class: **${c.key}** — ${c.desc}

Report: total cases run, number matching, and for every mismatch the exact argv array, expected (reference)
output, actual (port) output, and exit codes. If everything matches, say so explicitly with the case count.
Do not fix anything; just report. Be rigorous about actually running the cases rather than reasoning about them.`,
    { label: `fuzz:${c.key}`, phase: 'Fuzz' }),
)

phase('Review')
const REVIEW_LENSES = [
  { key: 'compliance', prompt: `Audit every file under /output for HARD RULE compliance. Read all the files. Check, and quote the offending line for each violation found:
1. Any \`require(\` or \`module.exports\` or \`exports.\` anywhere -> violation.
2. Any \`import\` of a non-relative specifier (bare package name or node builtin). Importing \`node:crypto\` in ANY form, or even MENTIONING it in a comment or string, is a hard violation. Grep for: crypto, pbkdf2Sync, createHmac, createHash, webcrypto, subtle, require, module.exports.
3. Every file ends in \`.mjs\`; every relative import specifier includes the explicit \`.mjs\` extension (no extensionless imports, no directory/index imports).
4. Entry point is exactly /output/test7.mjs; libraries are split into multiple modules, each exporting its interface.
5. No spawning of subprocesses, no embedded Python, no network, no reading of the reference binary at runtime.
6. No leftover test scaffolding, scratch files, or dead code under /output.
Also confirm the code actually runs from a different cwd (e.g. \`cd /tmp && node /output/test7.mjs --a 1 --b 2 --c 3\`) and that no import resolves via cwd. Report a checklist verdict with file:line for every problem.` },
  { key: 'crypto-correctness', prompt: `Review /output/lib/sha1.mjs, /output/lib/hmac.mjs, /output/lib/pbkdf2.mjs for correctness bugs by READING the code adversarially, then prove each concern empirically with a throwaway script in /tmp (do not modify /output).
Focus on classic pure-JS pitfalls:
* SHA-1: 32-bit overflow handling (must use >>>0 / | 0 consistently), rotate-left correctness, big-endian word packing, the 64-bit big-endian bit-length field (does it handle length >= 2^29 bytes, i.e. bit counts above 2^32? does it use floating-point math that loses precision?), padding when the final block has 55/56/57/63/64 bytes, incremental \`update()\` called with arbitrary chunk splits producing the same digest as one-shot, and reuse/reset of a hash object after \`digest()\` (double-digest must not corrupt state or silently return a wrong value).
* HMAC: key exactly 64 bytes, key 65 bytes (must be hashed then zero-padded), empty key, and that the inner/outer pads are not accidentally shared/mutated across calls (aliasing bugs in Uint8Array reuse).
* PBKDF2: block counter starts at 1 and is packed as 4-byte big-endian; XOR accumulation across all 1000 iterations (off-by-one: exactly 1000 PRF invocations per block, U_1 included); \`read(n)\` keystream buffering across successive calls; read(0); n larger than one block; and that no internal buffer is aliased so a returned array can be mutated by later reads.
Validate against: sha1("")=da39a3ee5e6b4b0d3255bfef95601890afd80709, sha1("abc")=a9993e364706816aba3e25717850c26c9cd0d89d, sha1(1e6 x "a")=34aa973cd4c4daa4f61eeb2bdbad27316534016f, sha1(448-bit and 512-bit boundary messages), RFC 2202 HMAC-SHA1 vectors, and RFC 6070 PBKDF2-HMAC-SHA1 vectors (P="password",S="salt",c=1 -> 0c60c80f961f0e71f3a9b524af6012062fe037a6; c=2 -> ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957; c=4096 -> 4b007901b765489abead49d926f721d065a429c1; and P="pass\\0word",S="sa\\0lt",c=4096,dkLen=16 -> 56fa6aa75548099dcc37d7f03425e0c3).
Report each finding with file:line, a concrete failing input, and the observed vs expected value. Report empirically-disproved concerns as such.` },
  { key: 'argparse-fidelity', prompt: `Review /output/lib/argparse.mjs and /output/test7.mjs against Python argparse's observable behaviour, using /workspace/dataset/test7_executable as the oracle (run it directly; NEVER run \`python\`). Read the JS, then empirically compare with a throwaway harness in /tmp (do not modify /output).
Check: the exact usage string and its wrapping; the help text layout including the blank line, the \`options:\` header, two-space indents and the column alignment of \`-h, --help  show this help message and exit\`; missing-required error wording, ordering and comma separation; unrecognized-arguments wording (and that it lists ALL leftovers, space-joined); expected-one-argument wording; which stream each goes to; trailing newlines; exit codes (2 for errors, 0 for help); last-duplicate-wins; \`--opt=value\` form; values beginning with \`-\`; and the \`--\` separator. Also check prog-name derivation: it must come from basename(process.argv[1]) rather than being hardcoded, and must not break when invoked via a relative path or from another cwd.
Report every divergence with file:line, the exact reference bytes vs the port's bytes, and the argv that triggers it. Note prog-name substring differences (test7.mjs vs test7_executable) as expected-by-design, not defects.` },
  { key: 'output-formatting', prompt: `Verify byte-exact output-formatting equivalence between \`node /output/test7.mjs\` and \`/workspace/dataset/test7_executable\` (run the binary directly; NEVER run \`python\`). Read /output/test7.mjs and the hex helper it uses, then empirically confirm with a throwaway /tmp harness (do not modify /output):
* Hex is lowercase, zero-padded to two chars per byte (hunt for a bug where a byte < 0x10 loses its leading zero, or where a byte is sign-extended) — construct or find inputs whose derived key contains bytes 0x00-0x0f in various positions and confirm 48 hex chars every time. Iterate over many random inputs and assert the output length is exactly 48 chars on every line.
* Exactly two lines, each terminated by \`\\n\`, with a trailing newline after the second and no extra blank line; nothing on stderr; exit code 0.
* No BOM, no \\r\\n, no ANSI codes, no buffering-order issue between the two lines, and stdout not truncated when piped to a closed pipe (e.g. \`| head -1\`).
* Confirm output is identical when stdout is a pipe vs a file, and when the locale is changed (LANG=C, LC_ALL=C, LANG=C.UTF-8) — Python's print encoding could differ from Node's; verify with a non-ASCII passphrase under each locale.
Report findings with file:line, the triggering input, and expected vs actual bytes. Quantify how many random cases you ran.` },
]

const reviews = await parallel(REVIEW_LENSES.map(l => () =>
  agent(`${l.prompt}\n\n## Context: the port's design contract\n${SPEC}\n\n## Implementer's own report\n${implNotes ?? '(unavailable)'}`,
    { label: `review:${l.key}`, phase: 'Review', effort: 'high' })))

const fuzzReport = FUZZ_CLASSES.map((c, i) => `### Fuzz: ${c.key}\n${fuzzResults[i] ?? '(fuzz agent failed)'}`).join('\n\n')
const reviewReport = REVIEW_LENSES.map((l, i) => `### Review: ${l.key}\n${reviews[i] ?? '(review agent failed)'}`).join('\n\n')

phase('Fix')
const fixNotes = await agent(
`You own the code under /output. Independent testers and reviewers examined it; triage and fix.

${SPEC}

## Differential fuzz results
${fuzzReport}

## Adversarial review findings
${reviewReport}

## Your job
1. Triage every reported finding: reproduce it first. Fix real defects. For anything you judge a
   false positive or an intentional, correct divergence (e.g. the prog-name substring in usage/error
   text, which must differ because argv[0] differs), say so with the evidence that disproves it.
2. Apply fixes directly to the files under /output, preserving the required module layout, ESM rules,
   and the absolute ban on importing or mentioning node:crypto.
3. Re-verify after fixing: all four sample cases, the empty-string case, the unicode case, the RFC 6070
   PBKDF2-HMAC-SHA1 vectors, the RFC 2202 HMAC-SHA1 vector, the SHA-1 known vectors, every CLI error/help
   case, and a fresh batch of at least 200 randomized differential cases (mixed ASCII/unicode/boundary
   lengths) against /workspace/dataset/test7_executable using an argv-array spawn (never run \`python\`).
4. Leave /output clean: only the library modules and test7.mjs, no scratch files.

Return: findings triaged (fixed / rejected-with-evidence), the diff summary per file, and the final
verification tally.`,
  { label: 'fix', phase: 'Fix', effort: 'high' })

phase('Final')
const acceptance = await parallel([
  () => agent(
`Clean-room acceptance check. You have NOT seen this code before; be skeptical and independent.

Target: \`node /output/test7.mjs --a <passphrase> --b <salt1> --c <salt2>\`
Oracle:  \`/workspace/dataset/test7_executable\` with identical args (run it directly; NEVER run \`python\`).

Do all of the following and report a PASS/FAIL verdict per item with evidence:
1. Read every file under /output. Confirm: ESM only (no \`require\`/\`module.exports\`), all files \`.mjs\`,
   all relative imports carry the \`.mjs\` extension, no bare/npm/builtin \`node:crypto\` import, no mention
   of node:crypto anywhere (grep), no subprocess spawning, no embedded Python, hierarchical multi-module
   split with \`export\`ed interfaces, entry point exactly /output/test7.mjs.
2. Run the four documented sample cases and confirm exact stdout + exit code 0:
   ('Lm8qH}*x','salt_346554','Ad32jimv') -> cf8a3a32ff637b7965a1c8b2b9cfaf3f283fba55428bf49d / b36aa0de2cd1534e26a3f16c005879ab998e9343173a50f8
   ('tgUa2lL[','salt_417146','KdjWSQgf') -> 3f42d56adb93749e9fd2cf03b31cffa5b37cad682ccaf966 / 65ef1bee7e7acebb86108ce0b5bf578736fcceb6ade38182
   ('6gU{zJV7','GHqA33x7mMiuwdKg','salt_007229') -> 1a1c68e6385e0c59f70d7dfedbbe2d3f77fc53cc631758a5 / 806480a5e8436817aa661606bbf59663c94fdba3ba529744
   ('cFfq,.ur','MVhmK4fpPRqXGF9b','NQGqkURv') -> d955e05c332f00c29df43c48a65a450eab64752cc2e180e8 / f49d697f6a450869b38e607c539cb6621d599fc978a6f256
3. Run 150+ fresh randomized differential cases (your own random mix of ASCII, unicode, empty, and
   boundary-length inputs) with an argv-array spawn; report the match tally and any mismatch verbatim.
4. Exercise the CLI error paths and --help; compare stdout/stderr/exit-code with the oracle (prog-name
   substring is allowed to differ).
5. Confirm it works from a different cwd and via a relative path invocation.
Do NOT modify anything. Report only.`,
    { label: 'acceptance', phase: 'Final', effort: 'high' }),
  () => agent(
`Completeness critic for a Python->Node.js ESM port. The deliverable is the code under /output
(entry: /output/test7.mjs), porting /workspace/dataset/pbkdf2/test7.py (PBKDF2-HMAC-SHA1, 1000 iters,
24-byte key, printed as two lowercase-hex lines).

${SPEC}

Read all the files under /output and ask: **what is still unverified or missing?** Specifically hunt for:
* any hard requirement above that no one actually checked;
* any input class that would break the port but was never tested (then TEST it against
  /workspace/dataset/test7_executable yourself — run the binary directly, NEVER \`python\`);
* library-quality gaps: is the split genuinely functional/hierarchical, are exports coherent and reusable,
  is the PBKDF2 class faithful to the Python API surface (iterations/digestmodule parameters, read()
  keystream semantics, hexread/close analogues) rather than a one-off inlined script;
* latent bugs that only appear outside the tested envelope (huge dkLen via multiple read() calls,
  non-default iteration counts, reuse of a PBKDF2 instance, passing raw bytes instead of a string).
Run the experiments needed to settle each question. Do NOT modify /output. Return a prioritised list of
genuine remaining gaps (or state clearly that you found none), each with the evidence you gathered.`,
    { label: 'completeness', phase: 'Final', effort: 'high' }),
])

return {
  implement: implNotes,
  fuzz: fuzzResults,
  reviews,
  fix: fixNotes,
  acceptance: acceptance[0],
  completeness: acceptance[1],
}
