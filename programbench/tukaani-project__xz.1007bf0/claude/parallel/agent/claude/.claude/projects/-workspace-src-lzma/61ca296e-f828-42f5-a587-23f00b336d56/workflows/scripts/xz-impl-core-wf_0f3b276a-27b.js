export const meta = {
  name: 'xz-impl-core',
  description: 'Implement checks, BCJ/delta filters and the .xz container layer of the reimplementation',
  phases: [{ title: 'Implement', detail: 'checks, filters, container in parallel' }],
}

const RULES = `
PROJECT: We are re-implementing xz / liblzma 5.8.2 from scratch in C, in /workspace.
The reference binary is /workspace/executable — you may RUN it to observe behaviour.

HARD RULES (violating these fails everything):
- Do NOT decompile/disassemble/objdump/nm/strings/gdb/strace/ltrace /workspace/executable.
- Do NOT search the web or any package registry for xz/liblzma/7-zip/LZMA-SDK source code.
- Do NOT install xz or read any copy of the original source. Write ORIGINAL code from your own
  knowledge of the published FILE FORMAT plus behaviour you observe by running the binary.
- You may read /workspace/doc/*.txt (bundled format specification), /workspace/README, /workspace/NEWS,
  and anything under /workspace/src or /workspace/notes.

CODE CONVENTIONS (follow exactly, the pieces must link together):
- C11, compiled with: gcc -O2 -std=gnu11 -D_GNU_SOURCE -Isrc -Isrc/common -Isrc/lzma -Isrc/filters
- Tabs for indentation, 8-wide, K&R braces, ~80 col; match the style already in /workspace/src.
- Read /workspace/src/common/common.h, /workspace/src/common/check.h,
  /workspace/src/common/filter.h and /workspace/src/xzr.h FIRST — they define the shared types
  (xr_ret, xr_vli, xr_filter, xr_next_coder, xr_stream, xr_block, xr_index, ...).
  Implement exactly the prototypes declared there. If you must add a declaration, add it to a NEW
  header in your own area, do not edit common.h / xzr.h (other agents are editing in parallel;
  if a change there is unavoidable, make it strictly additive and mention it in your summary).
- Error style: return xr_ret codes; never call exit() or print anything from library code.
- All allocations with malloc/calloc/free.
- Every file must compile cleanly with -Wall -Wextra (no warnings).

VERIFY your code compiles: gcc -c -O2 -std=gnu11 -D_GNU_SOURCE -Wall -Wextra -I/workspace/src -I/workspace/src/common -I/workspace/src/lzma -I/workspace/src/filters <file.c> -o /tmp/<x>.o
Fix all errors/warnings before finishing. Return a <=150 word summary listing the files you created
and anything the integrator must know (added prototypes, assumptions).
`;

phase('Implement')

const tasks = [
  {
    label: 'checks',
    prompt: `${RULES}

TASK: implement the integrity checks in /workspace/src/common/.

Files to create:
- /workspace/src/common/crc32_table.c  — the 8x256 CRC32 table (IEEE 802.3 polynomial 0xEDB88320,
  reflected). Generate the table with a small program you write and emit it as C source; do NOT
  hand-copy from anywhere. Slice-by-8 layout: table[0][i] is the classic table; table[n][i] =
  (table[n-1][i] >> 8) ^ table[0][table[n-1][i] & 0xFF].
- /workspace/src/common/crc64_table.c  — 4x256 CRC64 table, ECMA-182 polynomial reflected
  (0xC96C5795D7870F42).
- /workspace/src/common/crc32.c, crc64.c — xr_crc32()/xr_crc64() as declared in check.h.
  Semantics: init value 0, xz stores the final value; internally use crc = ~crc at both ends
  (standard reflected CRC). Verify: CRC32 of "123456789" (9 bytes, init 0) must be 0xCBF43926 and
  CRC64 must be 0x995DC9BBDF1939FA.
- /workspace/src/common/sha256.c — FIPS 180-4 SHA-256 producing big-endian digest bytes into
  check->buffer.u8[0..31] on xr_sha256_finish(). Verify SHA-256("abc") =
  ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.
- /workspace/src/common/check.c — xr_check_init/update/finish dispatching on type
  (0=none, 1=crc32, 4=crc64, 10=sha256) and the xr_check_sizes[16] array.
  IMPORTANT: xr_check_sizes must be the .xz spec table:
  {0, 4,4,4, 8,8,8, 16,16,16, 32,32,32, 64,64,64}.
  For CRC32 store the value little-endian in check->buffer.u8 at finish; likewise CRC64 (8 bytes LE).

Cross-check your CRC64 and SHA256 against the real binary: create a file, compress it with
'/workspace/executable -C crc64 -c f > f.xz' and '/workspace/executable -C sha256 -c f > f.xz',
and locate the stored check value in the hex dump (od -A d -t x1) — it sits right after the
compressed data and before the index. Confirm your implementation produces the same bytes.
Document that verification in your summary.`,
  },
  {
    label: 'filters-bcj-delta',
    prompt: `${RULES}

TASK: implement the Delta filter and all eight BCJ branch/call/jump filters in
/workspace/src/filters/. Create a header /workspace/src/filters/simple_private.h if useful.

Files:
- /workspace/src/filters/delta.c        — encoder+decoder, dist 1..256, streaming-safe
                                          (state must carry across calls).
- /workspace/src/filters/simple_coder.c — the shared streaming wrapper for BCJ filters
                                          (buffering of a partial tail, is_encoder flag, now_pos,
                                          start_offset handling, chaining to the next filter).
- /workspace/src/filters/x86.c, powerpc.c, ia64.c, arm.c, armthumb.c, arm64.c, sparc.c, riscv.c

Entry points (declared in /workspace/src/common/filter.h):
  xr_ret xr_delta_encoder_init(xr_next_coder *next, const xr_filter *filters);
  xr_ret xr_delta_decoder_init(xr_next_coder *next, const xr_filter *filters);
  xr_ret xr_simple_encoder_init(xr_next_coder *next, const xr_filter *filters);
  xr_ret xr_simple_decoder_init(xr_next_coder *next, const xr_filter *filters);
  uint64_t xr_delta_coder_memusage(const void *options);
xr_simple_*_init must dispatch on filters[0].id (XR_FILTER_X86 etc). Options are
xr_options_bcj{ uint32_t start_offset; } (may be NULL meaning start_offset 0) and
xr_options_delta{ uint32_t dist; }.

The chain plumbing: a non-last filter must call xr_next_filter_init(&coder->next, filters + 1,
is_encoder) to build the rest of the chain, and forward data through it. That function is
implemented by another agent in /workspace/src/common/filter_common.c; just declare and call it
per filter.h. For the ENCODER the filter transforms data then passes it to next.code(); for the
DECODER the data comes from next.code() and is then reverse-transformed. Handle the case
next.code == NULL (raw single-filter chain: then the filter is the last one and just copies
in->out while transforming).

CORRECTNESS IS CRITICAL AND MUST BE VERIFIED AGAINST THE BINARY. For each filter, use
  /workspace/executable --format=raw --filters=<name> -c < input > out       (encode)
  /workspace/executable --format=raw --filters=<name> -d -c < out > back     (decode)
Check first whether raw mode accepts a lone BCJ/delta filter; if it does, that gives you the
transform in isolation. Build a test corpus: random bytes, real ELF-like byte patterns,
0xE8/0xE9 sequences at many alignments, buffers >64 KiB to exercise streaming/buffer boundaries,
and every 'start=' offset variant. Write a script /workspace/tests/filters_check.sh plus a small
harness /workspace/tests/filtertest.c that links your filters and compares against saved reference
outputs produced by the binary; iterate until byte-identical on every vector.
Pay special attention to the x86 filter's prev_mask/prev_pos state machine and to how each filter
handles a partial instruction at the end of a chunk (data must be carried to the next call).

Save your reference vectors under /workspace/tests/vectors/ so the integrator can re-run them.`,
  },
  {
    label: 'container',
    prompt: `${RULES}

TASK: implement the .xz container layer in /workspace/src/common/.
Read /workspace/doc/xz-file-format.txt carefully — it is the authoritative specification and is
bundled with the task, so use it heavily.

Files to create:
- vli.c            — xr_vli_encode / xr_vli_decode (multibyte integers, 7 bits/byte, max 9 bytes,
                     no unnecessary trailing 0x80 bytes; value max 2^63-1).
- stream_flags.c   — xr_stream_header_encode/decode, xr_stream_footer_encode/decode,
                     xr_stream_flags_compare, XR_HEADER_MAGIC / XR_FOOTER_MAGIC.
- block_header.c   — xr_block_header_size (computes block->header_size), xr_block_header_encode,
                     xr_block_header_decode, xr_block_compressed_size, xr_block_unpadded_size,
                     xr_block_total_size.
- index.c          — the xr_index data structure + xr_index_* API from /workspace/src/xzr.h
                     (append, cat, iterators, sizes, checks bitmask, memusage), plus
                     xr_index_buffer_encode / xr_index_encoder.
- index_decoder.c  — xr_index_decoder / xr_index_buffer_decode (streaming index decoder with
                     memlimit support).
- index_hash.c     — a lightweight index verifier used by the stream decoder
                     (xr_index_hash_init/append/decode/size/end) — declare it in a new header
                     /workspace/src/common/index_hash.h.
- block_encoder.c, block_decoder.c — streaming block coders (xr_block_encoder_init /
                     xr_block_decoder_init) handling compressed/uncompressed size validation,
                     block padding and the integrity check.
- stream_encoder.c — xr_stream_encoder (single-threaded) using xr_block_encoder_init and index.
- stream_decoder.c — xr_stream_decoder supporting XR_CONCATENATED, XR_TELL_* flags,
                     XR_IGNORE_CHECK, stream padding (multiples of 4 zero bytes).
- stream_buffer.c  — xr_block_buffer_encode + xr_block_buffer_bound64 (used by the threaded
                     encoder; a block encoded into a caller buffer, with the "store uncompressed"
                     fallback when compression does not help).

Also implement in common.c: xr_strm_init, xr_code, xr_end, xr_next_end, xr_get_progress,
xr_get_check, xr_memusage/xr_memlimit_get/xr_memlimit_set — the generic streaming plumbing
declared in common.h/xzr.h. xr_code() must: validate the action, run next.code(), track
total_in/total_out, and return XR_BUF_ERROR when no progress is made twice in a row
(liblzma semantics).

Do NOT implement: the LZMA/LZMA2 coders, the BCJ/delta filters, filter-chain construction
(xr_raw_encoder_init/xr_raw_decoder_init/xr_properties_* live in filter_common.c, owned by
the integrator), the .lzma/.lzip formats, or the CLI. Just call the declared prototypes.

Verify structural correctness by running the reference binary: produce .xz files with
different checks, block counts (--block-list=100,200), presets and empty input, dump them with
od -A d -t x1, and confirm your encoder/decoder agree with the byte layout. Where you can, write
a small standalone test in /workspace/tests/ that round-trips your index/block-header code.`,
  },
];

const results = await parallel(tasks.map(t => () =>
  agent(t.prompt, { label: t.label, phase: 'Implement' })));

return results
