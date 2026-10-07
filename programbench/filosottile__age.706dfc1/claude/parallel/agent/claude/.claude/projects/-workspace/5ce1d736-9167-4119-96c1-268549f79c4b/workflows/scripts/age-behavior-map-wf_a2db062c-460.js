export const meta = {
  name: 'age-behavior-map',
  description: 'Exhaustively map the observable behavior of the provided age binary into spec files',
  phases: [
    { title: 'Probe', detail: 'parallel probe agents, one per behavior area' },
    { title: 'Critic', detail: 'completeness critic finds gaps' },
  ],
}

const COMMON = `
You are reverse-engineering the behavior of a compiled binary at /workspace/executable (a build of the
"age" file-encryption CLI, version string "v0.0.0-20260414014000-96fce988442d").

HARD RULES (violating these fails the whole task):
- You MUST NOT decompile, disassemble, or run objdump/nm/readelf/ghidra/strace/ltrace/gdb on /workspace/executable.
- You MUST NOT run 'strings' on it. You MUST NOT read its bytes.
- You MUST NOT search the internet or any package registry for age's source code, nor install age.
- Your ONLY allowed interaction is EXECUTING /workspace/executable with arguments/stdin and observing
  stdout/stderr/exit-code/output-files. You may also read /workspace/README.md and /workspace/doc/*.
- Do not modify or delete /workspace/executable. Do not write anything into /workspace at all.

Useful facts already established:
- The binary is ONLY the 'age' command (no keygen/inspect subcommands despite the docs).
- age native keys are bech32. Recipient hrp "age", identity hrp "AGE-SECRET-KEY-" (uppercased output).
- Known working classic keypair:
    identity:  AGE-SECRET-KEY-1N9JEPW6DWJ0ZQUDX63F5A03GX8QUW7PXDE39N8UYF82VZ9PC8UFS3M7XA9
    recipient: age1lvyvwawkr0mcnnnncaghunadrqkmuf9e6507x9y920xxpp866cnql7dp2z
  Second keypair:
    identity:  AGE-SECRET-KEY-1KTYK6RVLN5TAPE7VF6FQQSKZ9HWWCDSKUGXXNUQDWZ7XXT5YK5LSF3UTKQ
    recipient: age1gde3ncmahlqd9gg50tanl99r960llztrhfapnmx853s4tjum03uqfssgdh
- Files/fixtures you may reuse: /tmp/w/fx/key.txt, /tmp/w/fx/key2.txt, /tmp/w/fx/pub.txt, /tmp/w/fx/pt.txt
- Work in your OWN scratch dir: mkdir -p /tmp/w/<yourarea> and cd there.
- 'xxd' is NOT installed; use 'od -A d -t x1z' or python3.
- For anything needing a TTY (passphrase prompts), use python3's pty module, or the 'script' command.
  Example: script -qec '/workspace/executable -p /tmp/w/fx/pt.txt > /tmp/o.age' /dev/null < input.txt
  A robust python3 pty driver is often better; write one and reuse it.
- ALWAYS capture exit codes precisely (beware pipes changing $?).

DELIVERABLE: write a thorough, precise Markdown spec to the file path given below. It must be detailed
enough that another engineer can reimplement the behavior byte-for-byte WITHOUT access to the binary:
quote exact stdout/stderr strings (including trailing punctuation, capitalization, quoting style, and
whether output goes to stdout or stderr), exact exit codes, and exact byte layouts. Prefer concrete
transcripts over prose. Note anything you could not determine.
Return only a <=25 line summary of the most important findings; the file is the real output.
`

const AREAS = [
  {
    key: 'cli-encrypt',
    file: '/tmp/w/spec/01-cli-encrypt.md',
    prompt: `AREA: command-line parsing and error handling, ENCRYPTION side.

Map exhaustively:
- The exact usage/help text bytes for: no args at all; --help; -h; -help; an unknown flag. Which stream?
  exit code? Is the trailing "Example:" block present in all of them? (Note: 'age --help' output differs
  from the bare-error output -- verify precisely and record both in full.)
- Every accepted spelling of every flag: -e/--encrypt, -d/--decrypt, -o/--output, -a/--armor,
  -p/--passphrase, -r/--recipient, -R/--recipients-file, -i/--identity, -j, --version. Also test
  single-dash long forms (-encrypt, -recipient, -armor, -version...), --flag=value vs --flag value,
  clustered short flags like -ea, -er X, -pa. Record which work and which error and with what message.
- Argument errors: missing value for -r/-R/-i/-o/-j; two positional INPUT args; -r with -p; -p with -r;
  -p with -R; -p with -i; -i without -e (encrypt mode); -j without -e; -e with -d; -d with -r; -d with -R;
  -d with -p; -a with -d; -o with -d (allowed?); duplicate flags. Get the EXACT error + hint lines.
- "missing recipients" path and its hints.
- Unknown/invalid recipient strings: "foo", "age1", "age1xxxx", a valid-bech32 age1 string of wrong length,
  wrong-case, mixed case, an "AGE-SECRET-KEY-1..." passed to -r, an "age1pq1..." garbage, "age1tag1...",
  "age1example1..." (plugin, no plugin installed), "AGE-PLUGIN-FOO-1..." to -r, empty string to -r,
  ssh public keys with/without comment, unsupported ssh key types (ssh-dss, ecdsa-sha2-nistp256,
  sk-ssh-ed25519@openssh.com), truncated ssh keys.
- -R recipients file handling: nonexistent path, directory, empty file, only comments, blank lines,
  CRLF line endings, trailing whitespace on lines, leading whitespace, a line with an invalid recipient
  (what error, does it mention the line number and file name?), unsupported-but-valid ssh key (warning
  text?), "-" for stdin (and the rule that INPUT must be specified then), "-" twice, -R - together with -i -.
- -o behaviors: writing to an existing file, to a path in a nonexistent dir, to a directory, to /dev/null,
  "-" meaning stdout, file permissions of the created file (umask?), whether a partial file is left behind
  on error, and the "refuse to output binary to a TTY" behavior (use a pty) plus its exact message.
- What happens with a nonexistent INPUT file, INPUT is a directory, INPUT "-" for stdin.
- Does it ever print the "age: report unexpected or unhelpful errors at ..." trailer? On which errors?
  Find at least one error that does NOT print it, if any.`,
  },
  {
    key: 'cli-decrypt',
    file: '/tmp/w/spec/02-cli-decrypt.md',
    prompt: `AREA: command-line parsing and error handling, DECRYPTION side, plus identity-file parsing.

Map exhaustively (exact stderr text + exit codes):
- age -d with no -i at all on an X25519-encrypted file; on a scrypt(passphrase) file; on an ssh file.
- age -d -i on a passphrase-encrypted file (docs say this is an error) - exact message.
- Identity file parsing: nonexistent path; directory; empty file; only comments; blank lines; CRLF;
  a file with a bad key line (does the error include the file name and line number? exact format);
  a file with an "age1..." recipient instead of an identity; a file with multiple identities;
  a file with trailing/leading spaces; a file that is an age-encrypted (non-passphrase) file;
  a file that is a passphrase-encrypted age file (prompt text? use a pty); "-" for stdin (and whether
  INPUT must then be given); repeated -i; -i with an SSH private key.
- Decrypting with a wrong identity: exact error. With several identities where none match. With one
  matching among several. Identity order effects.
- Corrupt/invalid input to -d: empty input; random bytes; text that is not age; correct intro line but
  garbage after; unknown stanza type in header; missing "---" MAC line; bad MAC; truncated payload;
  extra trailing bytes after payload; a header with no recipient stanzas; header with a duplicate stanza;
  wrong version line ("age-encryption.org/v2"); armored input with bad base64; armored input with wrong
  PEM type; armored input with leading/trailing junk; armor with CRLF; armor with wrong line length;
  truncated armor (missing end line).
- Does -d write partial output before authentication failure? Test with a >64KiB payload whose last
  chunk is corrupted, and record whether output bytes appear and the exact error.
- Exit codes for each.
- Whether stdout is left empty/partial, and whether an -o output file is created/left behind on failure.`,
  },
  {
    key: 'format',
    file: '/tmp/w/spec/03-format.md',
    prompt: `AREA: byte-exact file format of the encrypted output.

Determine and document precisely:
- The header: intro line, stanza lines, wrapping rules for the base64 body of a stanza (line length? is
  the final line allowed to be full-length? what happens for a body that is an exact multiple of the wrap
  width - is an extra empty line emitted?), the "---" MAC line format, base64 padding (present/absent),
  the exact newline placement (is there a newline after the MAC line before the binary payload?).
- X25519 stanza: exact argument count and lengths of each base64 field.
- Total sizes: encrypt an empty file, 1 byte, 64KiB-1, 64KiB, 64KiB+1, 128KiB and record exact output
  sizes for 1 recipient. Derive the chunk size and per-chunk overhead and the payload nonce size.
- Multiple recipients: is stanza order the same as the -r order? Do duplicate -r produce duplicate
  stanzas? Combine -r and -R and -i and record the resulting stanza order. Does header size scale
  linearly?
- Determinism: is the output nondeterministic across runs for the same input+recipient? Which parts vary?
- Armor: exact BEGIN/END lines, base64 line length, final line handling, trailing newline at EOF,
  what happens for an empty payload, and the size relationship to the binary form. Encrypt sizes
  0,1,47,48,49,64KiB with -a and record exact byte counts and the last few lines.
- Reading armor on decrypt: is a trailing newline required? are CRLF line endings accepted? is trailing
  whitespace accepted? multiple PEM blocks? data before BEGIN? data after END?
- Whether the binary accepts (on decrypt) a header whose base64 uses padding, non-canonical base64,
  or stanza lines wrapped differently from what it emits. Test by hand-crafting headers: take a real
  encrypted file, re-wrap the stanza body, recompute nothing, and see if it complains about the MAC or
  about the encoding (the distinction tells you if the MAC covers the exact bytes).
- Maximum header size / stanza count limits, and error messages if exceeded.`,
  },
  {
    key: 'passphrase',
    file: '/tmp/w/spec/04-passphrase.md',
    prompt: `AREA: passphrase (scrypt) encryption and all interactive prompting.

Write a reliable python3 pty driver first, then map:
- age -p: exact prompt text (byte-exact, including any trailing space and whether it ends with a newline),
  which fd it is written to, and the exact confirmation prompt for a typed passphrase ("Confirm passphrase:"?).
  What happens if the two entries differ - exact message, does it retry, how many times?
- Empty passphrase -> autogeneration. Exact message text. The README shows
  'Using the autogenerated passphrase "..."' but the batchpass man page shows
  'age: using autogenerated passphrase "..."'. Determine which this build prints, byte-exact, and on which fd.
- The autogenerated passphrase shape: how many words, separator, character set. Collect at least 300
  distinct words by running many times in parallel (each run is slow due to scrypt; parallelize with
  xargs -P 16) and save the sorted unique word list to /tmp/w/spec/wordlist-sample.txt. Report the count
  of distinct words seen and whether all words are lowercase a-z, plus min/max word length.
- The scrypt stanza in the output: exact format "-> scrypt <salt> <workfactor>", the salt length, and the
  default work factor used by -p.
- Decryption: exact prompt text for -d on a passphrase file. Wrong passphrase: exact error, does it
  retry? how many attempts? What if stdin is not a TTY - can the passphrase be piped on stdin? Test
  'echo pass | age -d file' and 'age -d < file' combinations and record what happens.
- age -p when stdin is not a TTY and there is no terminal at all (e.g. setsid, or </dev/null): exact error.
- age -p with the INPUT coming from stdin and the passphrase from the TTY - does that work?
- Maximum work factor accepted on decrypt: craft scrypt stanzas with work factors 1, 2, 18, 20, 21, 22,
  30, 31, 0, -1, "018", "1e2", huge numbers, and record the exact errors (do NOT actually run a 2^30
  scrypt; you only need the error/acceptance boundary - use a tiny file and expect a MAC failure as the
  signal that the work factor was accepted).
- Whether a file with an scrypt stanza plus any other stanza is rejected, and the exact message.
- Whether -p combined with -a works and any prompt ordering differences.
- age -d on a passphrase file when -i is also given.`,
  },
  {
    key: 'ssh',
    file: '/tmp/w/spec/05-ssh.md',
    prompt: `AREA: SSH key support. ssh-keygen IS available; generate real keys.

Generate: ed25519, rsa 2048, rsa 3072, rsa 4096, rsa 1024 (too small), ecdsa, dsa if possible,
ed25519-sk placeholder strings, and both encrypted (-N pass) and unencrypted variants, in OpenSSH
format, plus PEM PKCS#1 (ssh-keygen -m PEM) and PKCS#8 (-m PKCS8) RSA keys.

Map:
- -r / -R with each public key type: accepted or rejected, exact error/warning text. Does -r reject
  unsupported-but-valid ssh keys with an error while -R only warns? Record both messages byte-exactly,
  including how the key is quoted in the message and whether the file name/line number appears.
- The resulting stanza lines for ssh-ed25519 and ssh-rsa: exact type string, number of arguments,
  and the byte length of each base64 argument (decode and report lengths). Confirm the 4-byte tag is
  a truncated hash of the SSH wire-format public key blob: compute sha256 of the base64-decoded blob
  from the .pub file with python3 and compare its first 4 bytes (base64url-unpadded) to the stanza tag.
  Report the comparison result explicitly.
- Decryption with -i for each private key format (OpenSSH unencrypted, OpenSSH encrypted, PEM PKCS#1,
  PKCS#8). For encrypted keys: exact passphrase prompt text (use a pty), and confirm the documented
  behavior that the prompt only appears if the identity matches the file (test with a non-matching file).
  Wrong passphrase: exact error and retry behavior.
- -i with an SSH public key file (not private): exact error.
- -i with a private key whose type is unsupported (ecdsa/dsa): exact error.
- rsa key size limits: minimum accepted bits (2048 per docs) - exact error for 1024. Also test a
  very large RSA key (8192) for acceptance.
- Whether an ssh recipient can be mixed with age1 recipients, and with age1pq1 recipients (the docs say
  PQ and classic can't be mixed - does ssh count as classic?).
- Whether the ssh-rsa stanza is deterministic across runs.
- Any ssh-agent related messages.`,
  },
  {
    key: 'pq-tag',
    file: '/tmp/w/spec/06-pq-tag.md',
    prompt: `AREA: post-quantum (age1pq1 / AGE-SECRET-KEY-PQ-1) and hardware-tag (age1tag1 / age1tagpq1) recipients.

You cannot generate these keys yet, so focus on OBSERVABLE structure and error messages. Use bech32
encoding/decoding written in python3 (bech32 with the standard BIP-173 checksum, charset
"qpzry9x8gf2tvdw0s3jn54khce6mua7l", 6-char checksum, constant 1) to synthesize candidate strings.

Determine:
- The exact expected data length for each recipient/identity type, by feeding bech32 strings of many
  different data lengths and recording when the error changes from a length complaint to something else.
  Types to probe: hrp "age" with a data payload starting with the "pq" prefix (note: "age1pq1..." is
  probably hrp="age" and the data begins with something that renders as "pq1", OR hrp="age1pq"; figure
  out which by constructing both and seeing which the binary accepts). Same question for age1tag1 and
  age1tagpq1. Report your conclusion with the evidence.
- Exact error messages for: wrong length, bad checksum, mixed case, uppercase, wrong hrp, empty data.
- The "can't mix post-quantum and classic recipients" error: exact text. Which combinations trigger it
  (age1pq1+age1, age1pq1+ssh, age1pq1+scrypt/-p, age1tagpq1+age1, age1tag1+age1pq1, age1tag1+age1)?
- Try to get a VALID age1tag1 recipient accepted: it is documented as P-256 ECDH. Use python3 (or Go, or
  openssl) to make a P-256 public key, try both compressed (33 bytes) and uncompressed (65 bytes)
  encodings as the bech32 payload, and find which one the binary accepts. Then record the resulting
  stanza: exact type string, argument count, and decoded argument lengths. Report the accepted payload
  encoding explicitly. Do the same for age1tagpq1 (expect ML-KEM-768 encapsulation key of 1184 bytes
  concatenated with the P-256 key - determine the order and total length by bisection on accepted lengths).
- For age1pq1: determine the accepted payload length (expect 1184-byte ML-KEM-768 encapsulation key
  plus a 32-byte X25519 key = 1216; verify, and determine the concatenation order if you can).
  Record the resulting stanza type string and argument lengths (you can encrypt to a bogus-but-well-formed
  key even if nobody can decrypt it - the encapsulation only needs a syntactically valid key. Note
  ML-KEM keys have a validity check (modulus reduction) so random bytes may be rejected: report the exact
  error if so).
- Whether AGE-SECRET-KEY-PQ-1 identities of a given length are accepted by -i (use 32 random bytes;
  the -e -i path will print nothing but should not error, and -d -i should give "no identity matched").
- The exact "-> " stanza type strings you observe for every recipient kind.`,
  },
  {
    key: 'plugin',
    file: '/tmp/w/spec/07-plugin.md',
    prompt: `AREA: the age plugin protocol and the -j flag.

Write a fake plugin as a shell or python script named 'age-plugin-test' on PATH that logs everything it
receives on stdin (and its argv and environment) to a file, and responds minimally. Iteratively discover
the protocol.

Determine and document:
- How age locates the plugin (PATH lookup of age-plugin-<name>), the argv it is invoked with
  (expect something like --age-plugin=recipient-v1 / --age-plugin=identity-v1), and whether it is one
  or two dashes.
- The exact stanza-based wire protocol on the plugin's stdin/stdout: the framing (lines starting with
  "-> " with SP-separated args, followed by base64 body lines wrapped at some width, terminated how),
  the command names in each phase, the ordering, and the expected responses ("ok", "done", "error",
  "recipient-stanza", "labels", "msg", "confirm", "request-secret", "extension-labels", ...).
  Record real transcripts verbatim.
- What -j PLUGIN does exactly: what identity string is synthesized and passed to the plugin, for both
  -e and -d.
- Error messages: plugin not found in PATH (exact text); plugin exits nonzero; plugin writes garbage;
  plugin returns an error stanza (how is the message shown to the user?); plugin returns no stanzas;
  protocol version mismatch.
- How "msg", "confirm" and "request-secret" from the plugin are surfaced to the user (use a pty).
- Whether age passes the file key / how many recipient stanzas it requests, and what it sends for
  multiple plugin recipients and for mixed plugin + native recipients.
- The exact behavior for -r age1test1<data> and -i AGE-PLUGIN-TEST-1<data> (bech32; write a python3
  bech32 encoder). Record what bytes of the recipient/identity the plugin receives (raw or bech32?).
- Whether the plugin's stdout stanza bodies must be wrapped, and the "unsupported" handling.
- Save all raw transcripts alongside the spec as /tmp/w/spec/07-plugin-transcripts.txt`,
  },
  {
    key: 'stream-misc',
    file: '/tmp/w/spec/08-stream-misc.md',
    prompt: `AREA: payload/STREAM details, plus miscellaneous behaviors.

Determine:
- The exact payload framing by size arithmetic: for one X25519 recipient, record header size and total
  size for plaintext sizes 0,1,100,65535,65536,65537,131071,131072,131073,200000. Derive: nonce length,
  chunk plaintext size, per-chunk tag size, and whether a final empty chunk is ever emitted (i.e. what
  happens at an exact multiple of the chunk size).
- Decrypt behavior on a payload whose final chunk is a full chunk but not marked final (truncate a
  128KiB file's ciphertext at exactly one chunk): exact error, and whether the first chunk's plaintext
  is still emitted.
- Whether the "empty payload" (0-byte plaintext) case produces one chunk of 16 bytes overhead.
- Whether decryption of a 0-length final chunk is rejected ("final STREAM chunk can't be empty"?).
- Round-trip a 5MB random file and confirm byte identity; time it roughly.
- Behavior when stdout is a closed/broken pipe (age ... | head -c 10): exit code and stderr.
- Behavior with SIGPIPE / very large input from stdin.
- Reading INPUT from a FIFO, from /dev/stdin, from a file that is being written.
- Exact behavior of --version with other flags (e.g. --version -r X, -r X --version).
- Environment variables the binary honors: test AGE_PLUGIN_PATH, TERM, NO_COLOR, HOME, PATH, TMPDIR,
  AGE_PASSPHRASE, AGE_PASSPHRASE_FD, AGE_PASSPHRASE_WORK_FACTOR, AGE_PASSPHRASE_MAX_WORK_FACTOR (the
  latter four are documented for the batchpass plugin - check whether the age binary itself honors them).
  Report which have any observable effect.
- Whether output to a TTY refusal applies to armored output and to decryption output.
- Whether it warns when encrypting to a very large number of recipients, or with an empty stdin.
- Locale/encoding handling of non-UTF8 file names and non-ASCII passphrases.
- Anything else surprising you find. Be creative and adversarial.`,
  },
]

phase('Probe')

const results = await pipeline(
  AREAS,
  (a) => agent(COMMON + '\n\nWRITE YOUR SPEC TO: ' + a.file + '\n\n' + a.prompt, {
    label: 'probe:' + a.key,
    phase: 'Probe',
  }),
)

phase('Critic')
const gaps = await agent(
  COMMON +
    `\n\nYou are a completeness critic. Read all the spec files in /tmp/w/spec/ (they were just written by\n` +
    `parallel probe agents covering: CLI encrypt, CLI decrypt, byte format, passphrase, ssh, pq/tag,\n` +
    `plugin protocol, stream/misc). Identify:\n` +
    `1. Contradictions between spec files.\n` +
    `2. Claims that are asserted but were clearly not tested against the binary.\n` +
    `3. Important observable behaviors that NO spec file covers.\n` +
    `Then actually RUN the binary to resolve the top ~15 most important gaps/contradictions yourself, and\n` +
    `write the resolutions to /tmp/w/spec/09-gaps.md. Return a summary of what you fixed and what remains unknown.`,
  { label: 'critic', phase: 'Critic' },
)

return { probes: results.map((r, i) => ({ area: AREAS[i].key, summary: r })), gaps }
