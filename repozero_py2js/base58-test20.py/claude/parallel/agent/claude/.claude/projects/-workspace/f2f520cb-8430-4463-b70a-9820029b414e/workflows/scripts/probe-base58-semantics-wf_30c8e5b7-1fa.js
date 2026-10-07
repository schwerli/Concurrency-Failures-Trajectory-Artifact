export const meta = {
  name: 'probe-base58-semantics',
  description: 'Black-box probe of the base58 Python executable: bytes repr, argparse, base58 core, int APIs, checksum, errors',
  phases: [
    { title: 'Probe', detail: 'parallel probe agents against /workspace/dataset/test20_executable' },
    { title: 'Verify', detail: 'adversarially re-verify each claimed rule with fresh commands' },
    { title: 'Spec', detail: 'synthesize a single implementation spec' },
  ],
}

const EXE = '/workspace/dataset/test20_executable'

const COMMON = `
You are probing a PRE-COMPILED Python program as a BLACK BOX to support an exact Node.js reimplementation.

Executable: ${EXE}
Source (read it first): /workspace/dataset/base58/test20.py

The program takes required args --a --b --c --d --e (str) --f --g (int) and prints 12 lines:
  1  enc1        = b58encode(a.encode())
  2  dec1        = b58decode(b)
  3  enc_check1  = b58encode_check(c.encode())
  4  dec_check1  = b58decode_check(enc_check1)     # == c.encode() raw bytes
  5  enc_int1    = b58encode_int(f)
  6  dec_int1    = b58decode_int(enc_int1)          # an int, not bytes
  7  enc2        = b58encode(d.encode())
  8  dec2        = b58decode(e)
  9  enc_int2    = b58encode_int(g)
 10  enc_check2  = b58encode_check(dec1)
 11  dec_check2  = b58decode_check(enc_check2)      # == dec1
 12  enc3        = b58encode(dec_check2)

HARD RULES:
- NEVER run 'python', 'python3', or any interpreter of the source. Only run the executable, and 'node' for your own scratch calculations.
- Use bash. A useful baseline invocation that always succeeds:
  ${EXE} --a 'Test123' --b '2' --c 'x' --d 'y' --e '3' --f 1 --g 2; echo "RC=$?"
- Vary ONLY the argument(s) you are probing; keep the others at safe values so the line you care about is the one that changes.
- Always capture the exit code, and capture stdout and stderr SEPARATELY (e.g. > /tmp/out 2> /tmp/err; echo $?).
- To see raw bytes of output when in doubt, pipe through 'od -c' or 'cat -A'.
- Line 4 echoes the exact raw bytes of --c, so line 4 is your microscope for how Python renders a bytes object.
- Run MANY probes (30+). Be systematic and exhaustive. Report ONLY what you actually observed, with the exact command and exact output. Mark anything you infer but did not directly observe as unverified.
`

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'rules', 'observations', 'uncertainties'],
  properties: {
    area: { type: 'string' },
    rules: {
      type: 'array',
      description: 'Precise, implementable rules derived from observation',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence', 'verified'],
        properties: {
          rule: { type: 'string', description: 'One implementable rule, stated precisely enough to code from' },
          evidence: { type: 'string', description: 'Exact command + exact observed output/exit code that proves it' },
          verified: { type: 'boolean', description: 'true only if directly observed, false if inferred' },
        },
      },
    },
    observations: {
      type: 'array',
      description: 'Raw command/output/exit-code triples worth keeping as test vectors',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['cmd', 'stdout', 'exit_code'],
        properties: {
          cmd: { type: 'string' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exit_code: { type: 'integer' },
        },
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

const AREAS = [
  {
    key: 'bytes-repr',
    prompt: `${COMMON}

YOUR AREA: exactly how Python renders a bytes object with print() (i.e. repr of bytes), character by character.

Determine the COMPLETE escaping table. Probe via --c (line 4 echoes --c's raw UTF-8 bytes) and via --b/--e (lines 2 and 8 show decoded bytes):
- Which quote character delimits the literal? Test: --c containing only a single quote; only a double quote; BOTH a single and a double quote; neither. Report the exact rule.
- Backslash. Test --c with one backslash, two backslashes.
- Control characters: probe TAB, LF, CR, and other C0 controls (use bash $'...' quoting, e.g. --c $'a\\tb'). Which get short escapes (\\t \\n \\r) and which get \\xNN? Check \\x00 \\x07 \\x08 \\x0b \\x0c \\x1b.
- Byte 0x7f (DEL) and the full 0x80-0xff range: probe non-ASCII text (e.g. 'é', '☃', '中', emoji) and report how the resulting multi-byte UTF-8 shows up. Is it always \\xNN lowercase hex, always 2 hex digits?
- Printable ASCII 0x20-0x7e: confirm all are shown literally (including space, #, $, %, &, *, (, ), {, }, |, ~, ^, backtick). Note which need shell escaping vs which are literal in output.
- Is there a b prefix on every bytes line? Is line 6 (an int) printed without quotes/prefix?
- Confirm exact trailing newline behaviour of the 12 printed lines (use od -c on the tail).
Also: can a byte 0x00 appear inside a longer bytes value, and how is it rendered (\\x00 vs \\0)? Probe via --b values that decode to embedded zeros (base58 '1' is a leading zero byte).`,
  },
  {
    key: 'argparse-cli',
    prompt: `${COMMON}

YOUR AREA: command-line parsing semantics, so a manual process.argv parser matches byte-for-byte.

Probe and report exactly:
- Space form '--a val' vs equals form '--a=val'. Both accepted? What about '--a=' (empty value)? And '--a ""'?
- Missing one required arg: exact stderr text (reproduce it verbatim, including the 'usage:' line and the program name shown) and exit code.
- Missing several required args: is the error listing all of them, in what order and format?
- No arguments at all: exact stderr and exit code.
- Unrecognized option (e.g. --z 1): exact stderr and exit code.
- A positional/extra bare token (e.g. trailing 'junk'): exact stderr and exit code.
- Duplicate option (--a x --a y): which wins?
- Option given with no value at end (e.g. ... --g with nothing after): exact stderr, exit code.
- '-h' and '--help': exact stdout and exit code. Also '--he', '--hel' (prefix abbreviation) — accepted?
- Prefix abbreviation of the value options: is '--' + single letter the full name already? Try an unknown longer prefix.
- Single-dash forms: '-a 1' — accepted or error? Exact message.
- '--' separator: does '${EXE} --a 1 -- --b 2 ...' work? What does it do?
- int parsing for --f/--g: which strings are accepted? Test: '5', '+5', '-5', ' 5 ' (surrounding spaces), '1_000', '0x10', '007', '5.0', '5e3', '', 'abc', a very large integer (e.g. 40 digits), and unicode digits like '٥'. For each: accepted (and resulting value seen on line 5/9) or rejected (exact stderr + exit code).
- Argument order: does reordering options change output? Does the program read args positionally at all?
Report the EXACT stderr strings verbatim — they will be reimplemented character for character. Note whether the program name in usage/error text is 'test20_executable' and where it comes from.`,
  },
  {
    key: 'base58-core',
    prompt: `${COMMON}

YOUR AREA: b58encode / b58decode core semantics (lines 1, 2, 7, 8, 12).

Determine and prove:
- The exact 58-character alphabet and its order. Derive it empirically: b58encode_int (line 5) of f = 0,1,2,...,57 gives you single characters in order. Also confirm which ASCII characters are ABSENT (0, O, I, l).
- Leading zero bytes: how does b58encode handle input bytes starting with 0x00? Probe indirectly: --b '1' gives dec1 = one zero byte, and line 12 re-encodes it. Try --b '11', '1z', '1112'. Confirm the "one leading '1' per leading zero byte" rule in both directions.
- Empty input: --a '' (line 1) — what is printed? --b '' (line 2) — what is printed, and does line 10/11/12 still work? Report exact output and exit code.
- b58decode with an invalid character (e.g. '0', 'O', 'I', 'l', ' ', '!', '+', a non-ASCII char): exact stderr (full traceback text if any), exit code. Which line of the program fails first — does ANY stdout appear before the failure?
- b58decode with surrounding or internal WHITESPACE: try --b ' 2', '2 ', ' 2 ', '2\\n' (use $'2\\n'), '2 2'. Accepted or rejected? This matters a lot — report precisely which whitespace positions are tolerated and whether they are stripped.
- Round-trip: pick several random ASCII strings for --a and verify line 1; pick the resulting encodings as --b and verify line 2 returns the original. Give at least 8 concrete (input, encoding) vector pairs to use as regression tests.
- Non-ASCII --a / --d: confirm .encode() is UTF-8 by checking the encoding of a known multi-byte string (compute the expected big-integer base58 of the UTF-8 bytes yourself with node using BigInt, and compare).
- Very long input (e.g. 200 chars) — confirm your BigInt model matches exactly.
Use node with BigInt to independently compute expected values and confirm the model: value = big-endian integer of the bytes; repeatedly divmod 58; prepend one alphabet[0] per leading zero byte.`,
  },
  {
    key: 'int-apis',
    prompt: `${COMMON}

YOUR AREA: b58encode_int (lines 5, 9) and b58decode_int (line 6).

Determine and prove:
- b58encode_int(0): exact output. (Is it the single first-alphabet char, or empty?)
- b58encode_int for 1..60 and around powers of 58 (57,58,59,3363,3364): tabulate exact outputs and confirm a pure divmod-58 model with NO leading-zero padding.
- Negative --f (e.g. -1, -5): does it error? If so, capture the FULL exact stderr traceback and exit code. If it succeeds, capture exact output. Do the same for --g. Note whether stdout is empty on failure.
- Very large --f (e.g. 2**64, 10**40, a 60-digit number): confirm arbitrary precision. Verify with node BigInt that the digits match a divmod-58 model.
- b58decode_int (line 6) always receives b58encode_int(f) — confirm line 6 always equals f exactly for all f you tested, including 0 and huge values. Is it printed as a plain decimal integer with no quotes, no 'b' prefix, no thousands separators, no 'n'?
- Does b58decode_int treat leading alphabet[0] chars as zeros/no-ops? Reason about it from the round trip, and state clearly whether the program's line 6 can ever differ from f.
- Check whether f and g share code paths: any case where line 5 and line 9 formats differ.
Give at least 15 concrete (int, encoded) vector pairs as regression tests.`,
  },
  {
    key: 'checksum',
    prompt: `${COMMON}

YOUR AREA: b58encode_check / b58decode_check (lines 3, 4, 10, 11).

Hypothesis to test: b58encode_check(payload) = b58encode(payload + first4bytes(sha256(sha256(payload)))).

Verify it INDEPENDENTLY using node's built-in crypto (node:crypto createHash('sha256')) plus BigInt base58 encoding you write yourself in a scratch node script under /tmp. Compare your computed value against the executable's line 3 for at least 12 different --c values, including:
- empty string --c ''
- 1-byte, 2-byte, 31-byte, 32-byte, 33-byte, and 200-byte payloads
- payloads with non-ASCII UTF-8 (so multi-byte)
- payloads whose bytes start with 0x00 — get these via line 10 instead: --b '1', '11', '1z' make dec1 start with zero byte(s), and line 10 is b58encode_check(dec1). Confirm leading-zero handling of the checksummed form (does one leading '1' appear per leading zero byte of payload+checksum?).
State clearly: is it single or double SHA-256? How many checksum bytes? Is the checksum appended (not prepended)? Confirm by also checking line 3 length vs payload length.
Also probe: does line 4 (b58decode_check of a freshly made valid string) ever differ from the original --c bytes? Any case where it fails?
Finally, determine what b58decode_check does on a CORRUPTED input — you cannot feed it directly, but reason about whether the program can ever hit that path, and say so explicitly.
Report your scratch node script's key logic in the rules so it can be reused.`,
  },
  {
    key: 'failure-modes',
    prompt: `${COMMON}

YOUR AREA: every way this program can fail, and the exact stderr + exit code for each.

Enumerate exhaustively and capture VERBATIM stderr (full multi-line traceback, exactly as bytes — use 'cat -A' or 'od -c' if needed to see exact whitespace) and the exit code:
1. --b or --e containing a character outside the base58 alphabet (test '0', 'O', 'I', 'l', '!', ' ', 'é').
2. --b or --e empty string.
3. --f or --g negative.
4. --f or --g non-integer.
5. Missing required args / unknown args (note exit code differs from tracebacks: argparse errors vs Python exceptions).
6. --a or --d containing characters that cannot be UTF-8 encoded (try passing a raw invalid UTF-8 byte via bash $'\\xff' — argparse may store a surrogate and .encode() may then raise; capture what happens exactly).
7. Anything else you can find.
CRITICAL for each failing case: does ANY output appear on stdout before the failure? (All 12 prints happen after all computation, so expect none — but VERIFY it, including with stdout redirected to a file.)
Also determine the exact traceback shape: does it mention file paths, module names, line numbers? Reproduce one complete traceback verbatim in an observation. Note that a Node reimplementation may need to match stderr only loosely, so ALSO state clearly which exit codes must match: report the exit code for each class of failure.`,
  },
]

phase('Probe')

const probed = await pipeline(
  AREAS,
  a => agent(a.prompt, { label: `probe:${a.key}`, phase: 'Probe', schema: FINDINGS }),
  (res, a) => {
    if (!res) return null
    // Adversarially re-verify each rule with fresh commands, in parallel per rule batch.
    const batches = []
    const rules = res.rules || []
    for (let i = 0; i < rules.length; i += 4) batches.push(rules.slice(i, i + 4))
    return parallel(batches.map((batch, bi) => () => agent(
      `${COMMON}

YOUR JOB: adversarial verification. Another agent probed area "${a.key}" and claims these rules about ${EXE}.
Your default assumption is that each rule is WRONG, over-general, or missing an edge case.

For EACH rule below, design and run FRESH commands (do not just repeat their evidence command) that would EXPOSE it if false. Try boundary values, empty values, and combinations. Then judge.

RULES TO ATTACK:
${batch.map((r, i) => `[${i + 1}] rule: ${r.rule}\n    their evidence: ${r.evidence}`).join('\n')}

For each: verdict "confirmed" (your fresh commands agree), "refuted" (you have a counterexample — give the exact command and output), or "needs_refinement" (mostly right but the precise statement must change — give the corrected statement). Default to refuted/needs_refinement when uncertain.`,
      {
        label: `verify:${a.key}#${bi + 1}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdicts'],
          properties: {
            verdicts: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['rule', 'verdict'],
                properties: {
                  rule: { type: 'string' },
                  verdict: { enum: ['confirmed', 'refuted', 'needs_refinement'] },
                  corrected_rule: { type: 'string' },
                  counterexample: { type: 'string' },
                },
              },
            },
          },
        },
      },
    ))).then(vs => ({ area: a.key, findings: res, verdicts: vs.filter(Boolean).flatMap(v => v.verdicts || []) }))
  },
)

const good = probed.filter(Boolean)

phase('Spec')

const spec = await agent(
  `You are writing the authoritative implementation spec for a Node.js (ESM, zero-dependency) reimplementation of this Python program:

Source: /workspace/dataset/base58/test20.py (read it)
Reference executable: ${EXE}

Six probe agents investigated the black-box behaviour, and adversarial verifiers attacked each claimed rule. Here is everything they found:

${JSON.stringify(good, null, 2)}

Your job: produce ONE coherent, precise, implementable spec. Rules:
- Where a verifier refuted or refined a rule, the CORRECTED version wins. Where evidence conflicts, run the executable yourself to settle it (you may run ${EXE} and node; never python).
- Resolve every contradiction explicitly. If something is still unknown, run more probes to settle it rather than guessing.
- The spec must be complete enough that an implementer never has to guess: exact alphabet string, exact algorithms, exact Python-bytes-repr escaping table, exact argparse behaviour and error strings with exit codes, exact int-printing format.
- Include a consolidated list of concrete regression test vectors (input args -> exact expected 12-line stdout) covering normal and edge cases.
- Note the implementation constraint: the Node code MAY NOT use Buffer or Uint8Array or TextEncoder/TextDecoder anywhere. Byte sequences must be plain JS arrays of numbers, and SHA-256 must be hand-implemented over such arrays (no node:crypto in the final deliverable). Call out anything in the spec that this constraint affects (notably: manual UTF-8 encoding of the argv strings, and manual SHA-256).
Return the spec as detailed markdown.`,
  { label: 'synthesize-spec', phase: 'Spec', effort: 'high' },
)

return { spec, areas: good.map(g => ({ area: g.area, ruleCount: g.findings.rules.length, verdicts: g.verdicts })) }
