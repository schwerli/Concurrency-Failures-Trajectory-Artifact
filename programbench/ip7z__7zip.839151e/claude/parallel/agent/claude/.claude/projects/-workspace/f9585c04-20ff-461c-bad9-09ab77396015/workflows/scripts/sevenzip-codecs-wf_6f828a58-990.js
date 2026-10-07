export const meta = {
  name: 'sevenzip-codecs',
  description: 'Implement the compression/hash/crypto codecs for the 7za reimplementation',
  phases: [{ title: 'Codecs', detail: 'one agent per codec module, each self-tested' }],
}

const COMMON = `
PROJECT: /workspace is an original from-scratch reimplementation of the 7-Zip 26.00 standalone
console archiver ("7za"). A reference binary exists at /workspace/executable — you may RUN it to
generate test fixtures, but you MUST NOT decompile/disassemble/strace it or read its bytes, and you
MUST NOT look up 7-Zip / LZMA SDK source code anywhere (no web, no package managers, no pip/apt/cargo).
Implement everything from your own knowledge of the published FORMAT specifications.

FIRST: read /workspace/src/common.h, /workspace/src/stream.h, /workspace/src/codec.h and
/workspace/src/hash.h. They define the interfaces you must implement against. DO NOT MODIFY those
four headers, and DO NOT create or modify any file in /workspace/src other than the ones assigned
to you. If you believe a header needs a change, say so in your report instead.

BUILD: C++17, g++ 11. Exceptions are used for errors (throw Exc(ERR_DATA) etc. — see common.h).
Code must be correct on x86-64 little-endian Linux. No external libraries. Keep the code
self-contained, readable, and in the same style as the existing headers (2-space indent, no tabs).
Prefer clarity over micro-optimisation, but the codecs must be fast enough to handle 100+ MB inputs
at reasonable speed.

SELF-TEST (mandatory): create a scratch dir /tmp/ct/<yourmodule>/ and write a small main() test
harness THERE (never in /workspace/src). Compile it together with your module and
/workspace/src/stream.cpp, e.g.
  g++ -std=c++17 -O2 -I/workspace/src /workspace/src/<yours>.cpp /workspace/src/stream.cpp test.cpp -o t
Run it against randomly generated data of many sizes (0, 1, 2, 100, 65535, 65536, 1<<20, 5<<20),
highly repetitive data, incompressible random data, and text. Verify round-trips byte-exactly.
Also verify interoperability with real data as described in your task.
Report honestly what passes and what does not.

USEFUL FIXTURE TRICK: a .7z file created by the reference binary with a single coder has its packed
stream starting at file offset 32, and the packed size equals the 64-bit little-endian value at
file offset 12 (NextHeaderOffset). So:
  /workspace/executable a -mhc=off -m0=LZMA out.7z input.bin
  python3 -c "import struct;d=open('out.7z','rb').read();n=struct.unpack('<Q',d[12:20])[0];open('stream.bin','wb').write(d[32:32+n])"
gives you a raw codec stream produced by the reference implementation, which you can feed to your
decoder to prove interoperability. (Only valid for a single-file, single-coder, non-solid archive;
verify with 'l -slt'.)
`;

const TASKS = [
  {
    key: 'hashers',
    label: 'hashers',
    prompt: `MODULE: /workspace/src/hashers.cpp  (plus optional /workspace/src/hashers.h)

Implement everything declared in /workspace/src/hash.h:
  CreateHasher(UInt64 id), CreateHasherByName(const char*),
  Crc32Calc, Crc32Update, Crc64Update, Sha256Buf, and the IHasher subclasses.

Algorithms required: CRC-32 (IEEE, reflected, poly 0xEDB88320, init/xorout 0xFFFFFFFF),
CRC-64 (the variant 7-Zip uses: reflected, poly 0xC96C5795D7870F42, init/xorout all-ones — VERIFY
this against the reference binary, see below), SHA-1, SHA-256, XXH64 (seed 0).

Digest byte order: Final() must write the digest in the order 7-Zip prints it. For SHA-1/SHA-256
that is big-endian words. For CRC32/CRC64/XXH64, 7-Zip prints them as a big-endian hex number of
DigestSize() bytes (CRC32 -> 4 bytes, CRC64 -> 8, XXH64 -> 8); make Final() emit big-endian so the
printer can just hex-dump the buffer. CONFIRM the exact expectation empirically:

  printf 'hello world\\n' > /tmp/ct/hashers/h.txt
  /workspace/executable h '-scrc*' /tmp/ct/hashers/h.txt
prints CRC32=AF083B2D CRC64=CFBF7F6AC4FFF2A1 SHA256=a948904f... SHA1=22596363... XXH64=5215E13B207D6D8C
Reproduce ALL FIVE of those values with your implementation for that exact 12-byte input, and for
several other inputs (empty file, 1 MB of zeros, 1 MB of random data, the string "abc", the classic
million-'a' test). Cross-check SHA-1/SHA-256 with python3 hashlib and CRC32 with python3 zlib.
XXH64 must match the reference binary for all your test inputs.

Performance: use table-driven CRC (8 slices is fine). Make sure Update() can be called with
arbitrary chunk splits and gives the same result as one big call — test that explicitly.

Also add (declare them in hashers.h, which you may create):
  // Streaming SHA-256 usable by the AES key derivation code.
  struct Sha256Ctx { void Init(); void Update(const Byte*, size_t); void Final(Byte[32]); ... };
so other modules can use SHA-256 without going through IHasher.`,
  },
  {
    key: 'lzma',
    label: 'lzma+lzma2',
    prompt: `MODULE: /workspace/src/lzma.cpp, /workspace/src/lzma.h, /workspace/src/lzma2.cpp
This is the most important module in the project. Take your time and be thorough.

Implement:
  ICoder *CreateLzmaDecoder(const CoderProps &p);   // props = 5 bytes: lclppb, dictSize LE32
  ICoder *CreateLzmaEncoder(const CoderProps &p);
  ICoder *CreateLzma2Decoder(const CoderProps &p);  // props = 1 byte dictSize code
  ICoder *CreateLzma2Encoder(const CoderProps &p);
(declared in /workspace/src/codec.h). GetProps() must return the property bytes an encoder needs
recorded in the container (5 bytes for LZMA, 1 byte for LZMA2).

DECODER: full LZMA decoder — range decoder, literal coder with lc/lp context, match/rep/shortrep
decoding, length coders (low/mid/high), distance slots + align bits, end-of-stream marker (dist ==
0xFFFFFFFF) support, and correct handling when outSize is known (stop exactly there) or unknown
(decode until marker or input end). It must work as a *streaming* coder: input arrives via
ISeqInStream::Read in arbitrary-sized pieces and output goes to ISeqOutStream. Use an internal
dictionary window of dictSize bytes (cap allocation sensibly, e.g. min(dictSize, needed)).

LZMA2 DECODER: chunked container. Control byte: 0x00 = end; 0x01 = uncompressed chunk with dict
reset; 0x02 = uncompressed chunk without dict reset (both followed by 2-byte big-endian (size-1)
then raw bytes); 0x80..0xFF = LZMA chunk where bits 5-6 of (control-0x80)>>5 give the reset mode
(0: continue, 1: state reset, 2: state reset + new props, 3: state reset + new props + dict reset),
unpacked size = ((control & 0x1F) << 16) + BE16 + 1, packed size = BE16 + 1, and for reset modes
>= 2 a props byte follows. The dictSize property byte encodes dictSize as:
  if (b == 40) dict = 0xFFFFFFFF else dict = (2 | (b & 1)) << (b / 2 + 11).

ENCODER: a real LZMA encoder, not a stub. Implement:
  - range encoder with the standard shift-low carry propagation
  - a hash-chain (HC4) match finder AND a binary-tree (BT4) match finder
  - the "optimum" dynamic-programming parser over a window of up to ~4096 positions (used for
    normal/max modes), plus a fast greedy/lazy mode for algo=0
  - price tables for literals, matches, rep-distances and lengths, periodically recalculated
  - correct rep0..rep3 distance handling and short-rep encoding
Compression LEVEL mapping (this must match 7-Zip's defaults — verify empirically, see below):
  level 0 -> effectively store/fastest, 1..4 fast mode, 5..9 normal mode;
  dictSize defaults: L1:64K(?) L3:1M(?) L5:16M L7:32M L9:64M — DERIVE THE REAL VALUES by running
  the reference: '/workspace/executable a -mx=N out.7z file; /workspace/executable l -slt out.7z'
  shows e.g. "Method = LZMA2:24" where 24 means dictSize = 1<<24. Also 7-Zip reduces the dictionary
  to the input size when the input is smaller (that is why tiny files show "LZMA2:12"). Determine
  the exact reduction rule empirically for a range of input sizes and implement it. Report the
  table you derived.
  numFastBytes default 32 for levels <= 7 and 64 for levels 8-9 (verify by comparing output sizes).
  lc=3, lp=0, pb=2 defaults.
Honour CoderProps: level, dictSize, numFastBytes, lc, lp, pb, algo, mf, reduceSize.
Support encoding with a known or unknown input size; when the caller passes inSize == null the
encoder must still work (buffer/stream the input).
The encoder must emit an end-of-stream marker only when the uncompressed size is NOT stored
(i.e. when inSize is unknown); when inSize is known, do not write the marker. Make that a
constructor/props flag if you prefer, defaulting to "marker only when size unknown".

LZMA2 ENCODER: split the input into chunks (max 2 MB uncompressed, max 64 KB packed per LZMA
chunk header limits — note packed size field is 16 bits so a chunk's packed size must be <= 65536;
handle that by limiting uncompressed chunk size and falling back to uncompressed chunks when the
compressed form would be larger). Keep the dictionary/match-finder history across chunks: the first
chunk uses reset mode 3, subsequent ones use mode 1 or 2 (no dict reset). Emit uncompressed chunks
(0x01/0x02, max 64 KB each) when compression does not help. Terminate with a 0x00 byte.

INTEROP TESTS (mandatory):
1. Your DECODER must decode streams produced by the reference binary. Use the fixture trick in the
   preamble with -m0=LZMA and -m0=LZMA2 over several inputs (text, random, 5 MB, highly repetitive)
   and several -mx levels, then check your decoded output == original file byte for byte.
   Note: for -m0=LZMA the 5 property bytes are in the archive header, but you can also just read
   them from 'l -slt' ... simpler: for LZMA the coder props are the 5 bytes; find them by trying the
   standard 5D 00 00 xx 00 pattern, or use -m0=LZMA:d20:lc3:lp0:pb2 and construct props yourself
   (byte0 = (pb*5 + lp)*9 + lc, then dictSize LE32).
2. Your ENCODER's output must be decodable by the REFERENCE binary. Build a valid .7z or .xz around
   your stream? That is awkward — instead do this: write a tiny helper that wraps your LZMA output
   in the .lzma (alone) container: 5 props bytes + 8-byte LE uncompressed size + stream. The
   reference can read that: '/workspace/executable x -tlzma yourfile.lzma -so | cmp - original'.
   Verify for many inputs. Do the same for LZMA2 by wrapping in .xz? Simpler for LZMA2: verify your
   LZMA2 encoder output round-trips through YOUR LZMA2 decoder, and additionally verify your LZMA2
   decoder against reference-produced LZMA2 streams (test 1). That combination is sufficient.
3. Compare compressed SIZES against the reference for the same input and level, and report the
   ratio (ours/theirs) for several files. Aim to be within a few percent; report the numbers.

Put shared declarations in lzma.h so lzma2.cpp can reuse the encoder/decoder internals.`,
  },
  {
    key: 'deflate',
    label: 'deflate',
    prompt: `MODULE: /workspace/src/deflate.cpp (+ optional /workspace/src/deflate.h)

Implement:
  ICoder *CreateDeflateDecoder(bool deflate64);
  ICoder *CreateDeflateEncoder(const CoderProps &p);

DECODER: raw DEFLATE (RFC 1951) — stored, fixed-Huffman and dynamic-Huffman blocks, streaming.
Deflate64 variant: window 64 KB, length code 285 means 16-bit extra length base 3, and distance
codes 30/31 exist with 14 extra bits (window up to 64 KB). Must stop cleanly at the final block and
must not consume input beyond the deflate stream when possible (the gzip/zip layers need to know
how many bytes were consumed — expose a way to query the number of input bytes actually consumed,
e.g. a virtual method or by making the coder read through a wrapper the caller owns; document what
you chose in your report. Simplest: add 'UInt64 GetInputProcessedSize() const' to your concrete
class and expose a factory that returns it via an out-parameter — but do NOT change codec.h; instead
declare an extra factory in deflate.h.)

ENCODER: a real DEFLATE compressor with dynamic Huffman blocks, a hash-chain match finder with
lazy matching, and stored-block fallback when a block would expand. Level mapping from
CoderProps::level: 0/1 fastest (greedy, small chain), 5 normal, 9 maximum (long chains, larger
nice-length). Also honour numFastBytes and passes if set.
Correctness matters far more than ratio, but aim for ratio close to zlib -9. Compare your output
size against 'gzip -9' and against the reference binary ('/workspace/executable a out.zip -mm=Deflate -mx9 file')
and report the ratios.

INTEROP TESTS (mandatory):
- Decode: use python3 zlib.compress(data,9)[2:-4] (raw deflate) and gzip-created files, plus
  reference-created .gz ('/workspace/executable a out.gz file' then strip the 10+ byte gzip header)
  and verify byte-exact decode. Test all three block types (force stored via incompressible data,
  fixed via tiny input, dynamic via text).
- Encode: verify python3 zlib.decompress(your_output, -15) reproduces the input exactly, for all
  the test sizes listed in the preamble.
- Deflate64: create a fixture by asking the reference to make one? 7za cannot create Deflate64.
  Instead verify Deflate64 decoding on ordinary deflate streams (Deflate64 is a superset for
  streams that use no 64K-specific codes) and carefully desk-check the extra code paths. Report
  that limitation honestly.`,
  },
  {
    key: 'bzip2',
    label: 'bzip2',
    prompt: `MODULE: /workspace/src/bzip2.cpp (+ optional /workspace/src/bzip2.h)

Implement:
  ICoder *CreateBZip2Decoder(const CoderProps &p);
  ICoder *CreateBZip2Encoder(const CoderProps &p);

Full bzip2 format: 'BZh' + level digit ('1'..'9'), blocks with magic 0x314159265359, block CRC,
randomised flag (must at least be handled on decode — the legacy randomisation table), origPtr,
symbol-map (16+16 bit), numGroups (2..6), numSelectors + MTF-coded selectors, per-group delta-coded
Huffman code lengths, MTF+RLE2 symbol stream, inverse BWT, RLE1 decode, and the final
0x177245385090 end-of-stream magic with the combined stream CRC. CRC is the big-endian
(non-reflected) CRC-32 with polynomial 0x04C11DB7, init 0xFFFFFFFF, final complement — the bzip2
variant, NOT the zlib one.

ENCODER: real bzip2 compression — RLE1, Burrows-Wheeler transform (use a suffix-array based
construction so it is fast and handles pathological inputs; a simple doubling algorithm or SA-IS is
fine), MTF + RLE2, Huffman coding with up to 6 tables refined over 4 iterations, selector MTF
coding. Default block size: derive from CoderProps::level (the reference binary's default for
'a out.bz2 file' — determine the level empirically by looking at the 4th header byte of an archive
it creates, and how -mx affects it; report the mapping). Also support multiple blocks for large
inputs, and CoderProps::numThreads may be ignored (single-threaded is fine).

INTEROP TESTS (mandatory):
- Decode files produced by the system 'bzip2' binary (available at /usr/bin/bzip2) at levels 1 and 9
  and by the reference binary ('/workspace/executable a out.bz2 file'). Verify byte-exact.
  Include an input larger than one block (e.g. 3 MB with -1) so multi-block handling is exercised.
- Encode: verify '/usr/bin/bzip2 -d' reproduces your output exactly, and that the reference binary
  can extract it ('/workspace/executable x -tbzip2 yours.bz2 -so | cmp - original').
- Test empty input, 1 byte, runs of identical bytes longer than 255 (RLE1 edge case), and data that
  triggers the RLE1 4+count escape.
Report your compressed sizes vs system bzip2 for the same level.`,
  },
  {
    key: 'ppmd',
    label: 'ppmd7',
    prompt: `MODULE: /workspace/src/ppmd7.cpp (+ optional /workspace/src/ppmd7.h)

Implement PPMd variant H (PPMd7), the variant used by 7-Zip's method 030401:
  ICoder *CreatePpmdDecoder(const CoderProps &p);   // props: 1 byte order, 4 bytes LE memSize
  ICoder *CreatePpmdEncoder(const CoderProps &p);
GetProps() on the encoder returns those 5 bytes.

This is a substantial algorithm: the PPMd7 model (suballocator with unit-based free lists and
glue-free-blocks, contexts/states, SEE contexts, binary summ tables, escape handling, model
restart on memory exhaustion, order 2..64, memory 2048..(1<<31)-1) plus the PPMd7 range coder
(7-Zip's variant, sometimes called Ppmd7z: 32-bit range coder with Range/Code, kTopValue = 1<<24,
Normalize when Range < kTopValue, and the decoder primes 4 bytes after an initial 0 byte).

Defaults for 7-Zip: order 6, memSize 16 MB at level 5 — VERIFY empirically:
  /workspace/executable a -m0=PPMd out.7z file ; /workspace/executable l -slt out.7z
shows "Method = PPMd:o6:mem16m" style text. Check several -mx levels and report the table.

INTEROP TEST (mandatory, this is the only way to know PPMd is right):
Use the fixture trick from the preamble with '-m0=PPMd' to obtain reference-produced PPMd streams
for several inputs (text, random, repetitive, 0 bytes, 5 MB) and several orders/mem settings
(-m0=PPMd:o4:mem2m, :o10:mem64m, :o32:mem16m). Your DECODER must reproduce the originals exactly.
Then check your ENCODER by feeding its output to your decoder AND by wrapping it so the reference
can read it — the cleanest way is to build a minimal .7z container by hand around your stream, or
simply compare: compress with your encoder, decompress with the reference's own decoder is not
directly reachable, so at minimum ensure encoder->your-decoder round-trips AND that your encoder's
output byte-length is close to the reference's for the same settings (report the numbers).
If you can make your encoder produce byte-identical output to the reference stream for a small
input, that is the strongest possible signal — try for it and report.

If you cannot get the full model correct, say so clearly rather than shipping something that
silently corrupts data; a decoder that throws Exc(ERR_UNSUPPORTED) is better than one that lies.`,
  },
  {
    key: 'branch',
    label: 'filters',
    prompt: `MODULE: /workspace/src/branch.cpp (+ optional /workspace/src/branch.h)

Implement the byte-level filters:
  ICoder *CreateCopyCoder();
  ICoder *CreateDeltaCoder(unsigned delta, bool encode);
  ICoder *CreateBranchCoder(UInt64 id, const CoderProps &p, bool encode);
  IMultiCoder *CreateBcj2Decoder();
  IMultiCoder *CreateBcj2Encoder(const CoderProps &p);
  bool IsFilterMethod(UInt64 id);
  void GetMethodStreamCounts(UInt64 id, unsigned &numIn, unsigned &numOut);

Branch converters (ids in codec.h): BCJ (x86 call/jump E8/E9 absolute<->relative conversion with
the standard 5-byte lookahead and the prevMask state machine), PPC (branch b/bl, 6-bit opcode 18,
mask 0x03FFFFFC, big-endian), ARM (BL, big/little: ARM uses little-endian 4-byte words where
byte[3]==0xEB, value = 24-bit << 2), ARMT (Thumb BL pairs: (b1 & 0xF8)==0xF0 && (b3 & 0xF8)==0xF8,
22-bit << 1), SPARC (call: 0x40000000 mask big-endian, with the sign extension trick), IA64 (bundle
templates table, 41-bit instruction slots, br.call), ARM64 (BL imm26 at (v & 0xFC000000) == 0x94000000,
plus ADRP handling (v & 0x9F000000) == 0x90000000 — 7-Zip's ARM64 filter converts BL with a 26-bit
field scaled by 4 and ADRP pages; implement 7-Zip's variant which uses a flag-less props with an
optional 4-byte start offset), RISCV, Swap2 (byte-swap 16-bit words), Swap4.
All branch filters take an optional 4-byte little-endian start-offset property (ip). Default 0.
They must work in STREAMING mode: buffer data and only convert complete instruction units, carrying
the tail (up to 4-16 bytes depending on the filter) to the next call. Alignment must be preserved
relative to the stream start.

BCJ2: 4 input streams on decode (main, call, jump, rc) -> 1 output; 1 input -> 4 outputs on encode.
The range-coder-driven variant used by 7-Zip: probability array of 2 + 256 entries, the decision
whether an E8/E9/0F8x branch is converted is coded with the range coder using a context derived from
the previous byte, and the absolute 32-bit target is stored big-endian in the call/jump streams.

TESTS:
- Delta and Swap: exhaustive round-trip on random data with all delta values 1..255 and arbitrary
  chunk splits (prove the streaming carry logic is right by feeding 1 byte at a time).
- Branch filters: round-trip encode->decode == identity on random data, with 1-byte-at-a-time
  feeding, for every filter.
- INTEROP (important): create fixtures with the reference binary that use the filters, e.g.
    /workspace/executable a -mhc=off -m0=Delta:4 -m1=Copy out.7z file
    /workspace/executable a -mhc=off -m0=BCJ -m1=Copy out.7z /bin/ls   (copy /bin/ls to your scratch dir first)
    /workspace/executable a -mhc=off -m0=ARM64 -m1=Copy out.7z somearm64.bin
  then extract the packed stream (offset 32, length = LE64 at offset 12) and check that your DECODER
  turns it back into the original file exactly, and that your ENCODER produces exactly those bytes.
  Do this for BCJ, Delta, ARM64, PPC, SPARC, ARMT, ARM, IA64, RISCV, Swap2, Swap4 — for the ones
  where you cannot build an input that exercises the filter, at least verify identity round-trip
  and report which ones lack interop coverage.
- BCJ2 interop: '/workspace/executable a -mhc=off -m0=BCJ2 out.7z bigbinary' produces 4 packed
  streams; that is harder to extract by hand, so at minimum ensure your BCJ2 encoder->decoder
  round-trips exactly, and try the fixture if you can work out the stream boundaries from
  'l -slt' output (it reports Method and sizes).`,
  },
  {
    key: 'aes',
    label: 'aes',
    prompt: `MODULE: /workspace/src/aes.cpp (+ optional /workspace/src/aes.h)

Implement:
  ICoder *CreateAesCoder(bool encode, bool isZipCrypto7z, const CoderProps &p);
where CoderProps::key and CoderProps::iv carry the raw key/IV for AES256CBC (id 06F00181), and for
7zAES (id 06F10701) the coder must parse the 7z AES property bytes itself.

Required pieces:
1. AES-256 block cipher (encrypt + decrypt) and CBC mode. Table-based implementation is fine.
   Verify against the FIPS-197 / NIST AES-256 test vectors (key 000102...1f, plaintext
   00112233445566778899aabbccddeeff -> ciphertext 8ea2b7ca516745bfeafc49904b496089) and against
   python3 if a crypto module is available (it probably is not — use the published vectors you know).
2. The 7zAES property format: byte0 = numCyclesPower | (ivSize>0 ? 0xC0 : 0) style —
   specifically: b0 bits 0-5 = numCyclesPower, bit 6 set if salt size is present, bit 7 set if iv
   size is present; if either is set, b1 = ((saltSize-1)<<4) | (ivSize-1); then saltSize bytes of
   salt, then ivSize bytes of IV (IV is zero-padded to 16 bytes). VERIFY this empirically by
   creating encrypted archives with the reference and hexdumping the coder props from an
   uncompressed header ('-mhc=off -p'): the props are visible in the header bytes.
3. The 7z key derivation: if numCyclesPower == 0x3F the key is salt+password truncated/padded;
   otherwise key = SHA256 over (salt || passwordUTF16LE || counter64LE) repeated 2^numCyclesPower
   times, where the 8-byte little-endian counter increments each iteration and the SHA-256 is a
   single running hash across all iterations. Default numCyclesPower is 19.
   The password is encoded as UTF-16LE without a BOM or terminator.
4. Provide a helper (declare it in aes.h) that other code can call:
     void Sevenzip_AesKeyDerive(const std::string &passwordUtf8, const Byte *salt, size_t saltSize,
                                unsigned numCyclesPower, Byte key[32]);
   and a way to construct an encoder that generates a random salt/IV and reports its props via
   GetProps().

Use the SHA-256 from /workspace/src/hashers.cpp (another agent is writing it; it will declare
Sha256Buf in hash.h and a streaming Sha256Ctx in hashers.h). To avoid a build-order dependency,
code against 'Sha256Ctx' from "hashers.h" and if that file does not exist yet, WAIT/RETRY by
implementing against the declaration you expect and note it in your report; do NOT define your own
duplicate Sha256Ctx symbol (you may use a local static SHA-256 for your unit test only, in
/tmp/ct/aes/).

INTEROP TEST (mandatory):
  /workspace/executable a -mhc=off -pSecret123 -m0=Copy enc.7z plain.txt
The packed stream (offset 32, length = LE64 at offset 12) is AES-CBC encrypted plaintext padded to
16 bytes. Recover the salt/IV/numCyclesPower from the archive header (it is uncompressed with
-mhc=off; the AES coder props are the bytes following the 7zAES coder id 06 F1 07 01). Derive the
key from "Secret123" and decrypt — you must recover plain.txt exactly. Do this for several
passwords including non-ASCII (e.g. 'pä§§' — check UTF-16LE handling) and several -mhe/-mhc
combinations. Report exactly which fixtures you verified.`,
  },
  {
    key: 'zstd',
    label: 'zstd-dec',
    prompt: `MODULE: /workspace/src/zstd_dec.cpp (+ optional /workspace/src/zstd_dec.h)

Implement a from-scratch Zstandard DECODER (RFC 8878 format) exposing:
  ICoder *CreateZstdDecoder();

Required: frame header parsing (magic 0xFD2FB528, frame header descriptor, window descriptor,
frame content size, dictionary id — reject dictionaries with Exc(ERR_UNSUPPORTED)), skippable
frames (0x184D2A5x), block types raw/RLE/compressed, literals sections (raw, RLE, Huffman with
and without a new tree, 4-stream mode), FSE table decoding, Huffman weight decoding (both FSE-
compressed and direct), sequences decoding (literal-length / match-length / offset-code FSE
tables with the predefined/RLE/FSE/repeat modes), the offset history (repeat offsets 1/4/8 rules),
sequence execution into the window, and the optional 4-byte XXH64 content checksum (verify it;
you may call Crc/xxh from hash.h — XXH64 is available via CreateHasher(HashID::kXXH64)).
Also handle multiple frames concatenated in one stream.

Streaming: input arrives via ISeqInStream::Read in arbitrary pieces. It is acceptable to buffer a
whole block at a time, and to keep a window of up to windowSize bytes.

TESTING is the hard part because no zstd tool is installed and the reference binary cannot CREATE
zstd. Do this:
1. Write your own minimal zstd ENCODER *in your test harness only* (/tmp/ct/zstd/, NOT in
   /workspace/src) that emits raw blocks and RLE blocks — that validates frame/block plumbing and
   the checksum, and produces files you can feed to the reference binary
   ('/workspace/executable l -slt f.zst' and 'x -tzstd f.zst -so') to confirm your understanding of
   the container is right (if the reference accepts your handmade file, your header layout is
   correct).
2. Hand-construct (in python3, in your scratch dir) small compressed-literal and FSE-sequence blocks
   from the RFC's worked examples / your own encoder to exercise the Huffman and FSE paths, and
   cross-check your decoder against the reference binary's decoder by running
   '/workspace/executable x -tzstd f.zst -so' and comparing.
3. If you can, write a small real compressor (Huffman literals + FSE sequences with predefined
   tables) in your test harness to generate genuinely compressed frames, then check both decoders
   agree.
Report exactly what you covered and what remains unverified. Correctness over completeness: if
something is not implemented, throw Exc(ERR_UNSUPPORTED) rather than producing wrong bytes.`,
  },
];

phase('Codecs')
const out = await parallel(TASKS.map(t => () =>
  agent(COMMON + '\n\n' + t.prompt, { label: t.label, phase: 'Codecs' })
))

return TASKS.map((t, i) => ({ key: t.key, report: out[i] }))
