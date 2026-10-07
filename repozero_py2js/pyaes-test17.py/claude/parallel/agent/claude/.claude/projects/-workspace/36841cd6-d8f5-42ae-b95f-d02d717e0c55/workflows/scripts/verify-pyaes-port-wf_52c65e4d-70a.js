export const meta = {
  name: 'verify-pyaes-port',
  description: 'Adversarially verify the Node ESM port of test17.py against the reference binary: fuzz, known-answer vectors, requirement audit, and a completeness critic',
  phases: [
    { title: 'Fuzz', detail: 'differential fuzzing shards vs the reference binary' },
    { title: 'Audit', detail: 'independent lenses: crypto correctness, requirements, code quality' },
    { title: 'Critic', detail: 'what is still unverified' },
  ],
}

const REF = '/workspace/dataset/test17_executable'
const MINE = '/output/test17.mjs'

const PREAMBLE = `CONTEXT
=======
A Python program, /workspace/dataset/pyaes/test17.py, has been ported to Node.js ESM.

The Python original:
  import argparse, pyaes
  def main():
      parser = argparse.ArgumentParser()
      parser.add_argument('--key', type=str, required=True)
      parser.add_argument('--iv', type=str, required=True)
      parser.add_argument('--data', type=str, required=True)
      args = parser.parse_args()
      aes = pyaes.AESModeOfOperationCBC(args.key.encode(), args.iv.encode())
      data = args.data.encode()
      ciphertexts = []
      for i in range(0, len(data), 16):
          block = data[i:i+16]
          cipher = aes.encrypt(block)
          ciphertexts.append(cipher)
      for cipher in ciphertexts:
          print(cipher)
  if __name__ == '__main__': main()

REFERENCE BINARY (ground truth, run it freely): ${REF}
PORT UNDER TEST: node ${MINE}
Port source tree: /output/test17.mjs plus /output/lib/**.mjs

HARD REQUIREMENTS the port must satisfy:
- Pure JavaScript for Node.js, ES Modules only. import/export only; require() and module.exports are FORBIDDEN.
- All files must use the .mjs suffix, and intra-project imports must include the full suffix.
- ZERO external/npm dependencies. Only relative local-file imports are allowed.
- Must NOT use Node's built-in cipher API (createCipheriv / Cipher / Decipher) — AES must be implemented from scratch. It must not even be named in the source.
- No embedding or invoking Python.
- Byte-for-byte identical stdout to the reference, plus matching exit codes.

KNOWN, ACCEPTED DIFFERENCE: the reference is a PyInstaller binary whose crash
banner embeds its own PID ("[PYI-12345:ERROR] ..."). The port emits its own PID
there. When comparing stderr, normalise /\\[PYI-\\d+:ERROR\\]/ on both sides.

ALSO NOTE: the reference binary is occasionally flaky under load — it can exit
with a null/signal status and no output. If a comparison fails, RE-RUN the exact
same reference command 3 times before believing the failure is real.

Write all scratch files and harnesses in /tmp. Do NOT modify anything in /output.
`

const FUZZ_SHARDS = [
  {
    key: 'cbc-core',
    prompt: `Differentially fuzz the CORE happy path. Write a Node script (in /tmp) that generates at least 500 random valid invocations and compares the port to the reference on stdout, stderr and exit code.

Vary: key byte-length in {16,24,32}; IV 16 bytes; data length a multiple of 16 from 0 up to 32 blocks. Draw characters from the full printable-ASCII range including apostrophe, quote mark, backslash, space, '=' and '-'. Pass arguments with spawnSync WITHOUT a shell so no quoting is involved.

Report: how many cases you ran, how many matched, and for any genuine mismatch the exact argv array plus both outputs. Do not stop at the first mismatch — collect them all.`,
  },
  {
    key: 'repr-stress',
    prompt: `Differentially fuzz with the goal of stressing Python's repr(bytes) formatting.

Ciphertext bytes are effectively uniform random, so run enough cases (at least 400 invocations x 3 blocks) that you observe every byte value 0x00-0xff in the output at least once, and specifically observe ciphertext blocks that contain: an apostrophe (0x27) and no quote mark; a quote mark (0x22) and no apostrophe; BOTH; a backslash (0x5c); 0x09/0x0a/0x0d; 0x07/0x08/0x0b/0x0c (which Python must render as backslash-x07 etc., NOT as backslash-a / backslash-b / backslash-v / backslash-f); 0x00; 0x7f; and 0x80 and above.

Write the harness in /tmp. Compare port vs reference byte-for-byte. Then report: the counts, evidence that each of the listed conditions was actually hit (show the matching output lines), and any mismatch. If after your budget some condition was never hit, say so explicitly rather than claiming coverage.`,
  },
  {
    key: 'argparse-fuzz',
    prompt: `Differentially fuzz the ARGUMENT PARSING. Write a generator (in /tmp) that emits at least 600 random argv arrays built from a pool of tokens, and compare port vs reference on stdout, stderr and exit code.

Token pool should include: --key, --iv, --data, -h, --help, --k, --ke, --i, --d, --da, --dat, --key=X, --iv=X, --data=X, --key= (empty value), -h=1, -hh, -hx, -h- , -h--, -hkey, -h= , --=x, -=x, ---key, the bare separator --, a bare -, -5, -1.5, -.5, -0, --0, -x, -xh, a plain positional word, the empty string, a value containing spaces, a dash-prefixed value containing spaces, --unknown, --unknown=1, --he, --hel, --help=1, 16-character values, 48-character values, and values that themselves look like option names.

Build arrays of length 0 to 8 from that pool, uniformly at random, plus every 1-token and 2-token combination exhaustively if that is affordable.

Compare with the PYI-PID normalisation. Report count run, count matched, and every genuine mismatch with the exact argv array and both sides' output. Do not stop early.`,
  },
  {
    key: 'error-paths',
    prompt: `Differentially test every RUNTIME FAILURE path and every unusual encoding case.

Systematically cover, comparing port vs reference on stdout, stderr and exit code:
- key byte-length 0..40 inclusive (all 41 values) — only 16/24/32 should succeed
- IV byte-length 0..20 inclusive
- data byte-length 0..40 inclusive
- all combinations of {bad key, good key} x {bad IV, good IV} x {bad data, good data} — confirm which error wins
- multibyte UTF-8: 2-byte (e-acute), 3-byte (CJK), 4-byte (emoji) characters in key, IV and data, arranged so the BYTE length is and is not a multiple of 16; confirm the port slices by bytes not characters. Include a case where character-slicing and byte-slicing would give different answers and confirm which the reference does.
- data of exactly 1 block, and of 1000 blocks (16000 bytes) — check the port produces the same 1000 lines
- whether stdout is empty when the run dies partway through the block loop (e.g. 17-byte data)

Write your harness in /tmp. Report a table and every genuine mismatch.`,
  },
]

phase('Fuzz')
const fuzz = await parallel(FUZZ_SHARDS.map(shard => () =>
  agent(`${PREAMBLE}\nYOUR TASK\n=========\n${shard.prompt}`, {
    label: `fuzz:${shard.key}`, phase: 'Fuzz',
  })
))

const AUDITS = [
  {
    key: 'aes-correctness',
    prompt: `Audit the AES implementation in /output/lib/aes/ for CRYPTOGRAPHIC CORRECTNESS, independently of the CLI.

1. Read /output/lib/aes/galois.mjs, tables.mjs, key-schedule.mjs, block-cipher.mjs, modes/ecb.mjs, modes/cbc.mjs.
2. Write a Node test script in /tmp that imports those modules directly and checks them against the FIPS-197 / NIST known-answer vectors you know from memory. At minimum:
   - The generated S-box must equal the published AES S-box. Spot-check many entries: SBOX[0x00]=0x63, SBOX[0x01]=0x7c, SBOX[0x10]=0xca, SBOX[0x53]=0xed, SBOX[0x7f]=0xd2, SBOX[0xff]=0x16. Verify INV_SBOX is the exact inverse permutation for all 256 values, and that SBOX is a bijection.
   - FIPS-197 Appendix B: key 2b7e151628aed2a6abf7158809cf4f3c, plaintext 3243f6a8885a308d313198a2e0370734 gives ciphertext 3925841d02dc09fbdc118597196a0b32.
   - FIPS-197 Appendix C.1 (AES-128): key 000102..0f, plaintext 00112233445566778899aabbccddeeff gives 69c4e0d86a7b0430d8cdb78070b4c55a
   - C.2 (AES-192): key 000102..17 gives dda97ca4864cdfe06eaf70a0ec0d7191
   - C.3 (AES-256): key 000102..1f gives 8ea2b7ca516745bfeafc49904b496089
   - SP 800-38A CBC-AES128: key 2b7e151628aed2a6abf7158809cf4f3c, IV 000102030405060708090a0b0c0d0e0f, plaintext blocks 6bc1bee22e409f96e93d7e117393172a / ae2d8a571e03ac9c9eb76fac45af8e51 / 30c81c46a35ce411e5fbc1191a0a52ef / f69f2445df4f9b17ad2b417be66c3710 give ciphertext 7649abac8119b246cee98e9b12e9197d / 5086cb9b507219ee95db113a917678b2 / 73bed6b8e3c1743b7116e69e22229516 / 3ff1caa1681fac09120eca307586e1a7
   - Round-trip: for 200 random key/IV/plaintext triples across all three key sizes, encrypt then decrypt through the CBC class and confirm you recover the plaintext. Do the same for ECB.
   - Confirm the CBC class chains state across successive encrypt() calls, and that encrypting a 48-byte message as 3 separate 16-byte calls equals feeding block 1's ciphertext in as the IV for block 2, and so on.
   Report every vector as PASS/FAIL with the actual bytes you computed. If you are not fully certain of a vector's published value from memory, SAY SO and mark it "unverified vector" rather than reporting a false FAIL — but still report what the implementation produced.
3. Independently: does the implementation avoid Node's built-in cipher API entirely? grep for crypto, createCipheriv, Cipher, Decipher, subtle, webcrypto across /output. Report exactly what you find and in what context (a comment versus a call).

Return findings as a list. Be concrete: file, line, what is wrong, and why it matters.`,
  },
  {
    key: 'requirements',
    prompt: `Audit /output against the HARD REQUIREMENTS listed above, as a strict reviewer looking for reasons to reject.

Check every one, with evidence:
1. Every file under /output uses the .mjs suffix. List all files.
2. No file contains require( or module.exports or an exports. reference anywhere. grep and show results.
3. Every import statement: is it a relative local path, and does it include the full .mjs suffix? Enumerate EVERY import in EVERY file and classify it. Any bare-specifier import (npm package or node: builtin) is a violation of the stated rules — flag it if present.
4. No Python is embedded, spawned, or referenced as an executable dependency. Check for child_process, spawn, exec, python.
5. The library is genuinely split into multiple modules BY FUNCTIONALITY and exposes interfaces via export — not one giant file plus stubs. Judge whether the decomposition is real and sensible, and say what each module is responsible for.
6. The entry file is /output/test17.mjs and it parses process.argv without any argument-parsing library.
7. Command-line surface matches the Python exactly: option names --key/--iv/--data, all three required, no defaults, string type.
8. Run: node /output/test17.mjs with the four documented sample cases from the source file's comment block and confirm byte-identical stdout. The samples are in /workspace/dataset/pyaes/test17.py — read them from there.

Also flag anything a reviewer would consider a smell: dead code, unused exports, a module that exists only for appearances, hardcoded values that should be derived, comments that describe something other than what the code does, or an unused parameter.

Return a verdict per requirement plus a list of concrete defects.`,
  },
  {
    key: 'code-quality',
    prompt: `Review /output/lib/**.mjs and /output/test17.mjs as a senior engineer doing a merge review. Look for real DEFECTS, not style preferences.

Read every file. Then specifically hunt for:
- Off-by-one and boundary bugs in the AES state permutations (ShiftRows/InvShiftRows column-major indexing), the key schedule (the AES-256 extra SubWord at i%nk==4, the Rcon index advance), and the block loop in app.mjs.
- Aliasing bugs: does CBC's encrypt() store a reference to a buffer that a later call mutates? Does block-cipher.mjs mutate its input? app.mjs passes data.subarray(i, i+16) — a VIEW, not a copy — into encrypt(). Trace whether anything downstream writes through that view. Construct a test that would expose it if it were wrong.
- The bytes-repr quote-selection logic: is the "apostrophe present and no quote mark" rule implemented exactly? What happens for zero-length input, and for input containing both?
- The UTF-8 encoder in bytes.mjs: surrogate pair recombination, the unpaired-surrogate position reported in the error message, and boundary code points 0x7f/0x80/0x7ff/0x800/0xffff/0x10000.
- The argparse emulation: any path where a token is silently dropped, where an option value could be taken from the wrong index, where the short-option chaining loop could spin forever, or where the returned stop index leaves the outer while loop unable to advance (infinite loop). Prove termination or find the counterexample.
- Error handling in app.mjs: the traced() helper mutates a caught error object and rethrows. Can that mislabel an error raised from a different call site? Is the scriptFrames property ever set twice?
- test17.mjs buffers all output then writes it. What happens on EPIPE (for example when the output is piped into head -1)? Compare to the reference binary's behaviour under the same pipe.

For each candidate defect, WRITE AND RUN a test that demonstrates it before reporting it. Report only what you could demonstrate, plus a separate clearly-labelled list of "suspicious but could not trigger". Include file and line numbers.`,
  },
  {
    key: 'pipe-and-env',
    prompt: `Test the port's behaviour in hostile execution environments, comparing against the reference binary.

Cover:
- Output piped to a command that closes early: pipe into head -1, and pipe into true. Compare exit status and stderr of port versus reference. Node can raise EPIPE where CPython raises BrokenPipeError; determine what each actually does and whether it matters.
- stdout redirected to /dev/full (write error).
- Very large output (16000 bytes of data, so 1000 lines) piped and fully consumed; confirm no truncation on either side. Also check with output redirected to a file and compare file bytes exactly.
- COLUMNS environment variable set to small values (20, 40, 60) and large (200) — does the reference binary's --help and usage text wrap? Does the port's? Compare exactly for COLUMNS=20,40,60,80,200 and with COLUMNS unset. Report whether the port needs to implement usage-line wrapping to match.
- TERM unset, LC_ALL=C, LANG=C, and LC_ALL=en_US.UTF-8 with multibyte arguments — does the reference's handling of non-ASCII argv change with locale? Compare the port.
- Running from a different working directory (cd / then node /output/test17.mjs ...).
- Arguments containing a literal newline or tab (use bash dollar-single-quote escaping).
- Invalid UTF-8 byte sequences in argv, for example the two bytes 0xff 0xfe repeated to 16 bytes. What does the reference do (Python decodes argv with surrogateescape, so .encode() may raise UnicodeEncodeError)? What does the port do? Report the exact difference — this is a real potential divergence, so characterise it precisely rather than glossing over it.

Report a table: scenario, reference behaviour, port behaviour, match or differ; and for each difference say whether it is fixable and how.`,
  },
]

phase('Audit')
const audits = await parallel(AUDITS.map(a => () =>
  agent(`${PREAMBLE}\nYOUR TASK\n=========\n${a.prompt}`, {
    label: `audit:${a.key}`, phase: 'Audit',
  })
))

phase('Critic')
const everything = [...fuzz, ...audits].filter(Boolean).join('\n\n---\n\n')

const critic = await agent(
`${PREAMBLE}

Below are the reports from four differential-fuzzing shards and four independent audits of the port.

Your job as the completeness critic: decide what is STILL NOT VERIFIED, and verify it yourself.

Specifically:
- Which behaviours does no report actually cover with evidence? (Look for claims made without a command and its output.)
- Which reported "failures" are actually the known flakiness of the reference binary, or the known PID difference? Re-run and settle them.
- Which reported defects are real? For each, reproduce it yourself with a concrete command before agreeing.
- Is there any input class nobody tried? Think about: argument order permutations, repeated options, option values that are themselves valid option names, extremely long arguments (near ARG_MAX), data whose length is a multiple of 16 but very large, and interactions between -h and errors.
- Run the four documented sample cases yourself and confirm byte-identical output.

Then produce a final verdict with these sections, in this order:
1. CONFIRMED DEFECTS — real, reproduced, with the exact command and the diff. Ranked by severity. If none, say "none".
2. ACCEPTED DIVERGENCES — differences that cannot be eliminated (such as the PYI PID) or that fall outside the program's contract, each with a one-line justification.
3. UNVERIFIED — anything still resting on assertion rather than evidence.
4. COVERAGE SUMMARY — total differential cases actually executed across all shards, and what they spanned.

Be skeptical. Do not repeat a report's claim without checking it. Reports below:

${everything}`,
  { label: 'completeness-critic', phase: 'Critic' }
)

return critic
