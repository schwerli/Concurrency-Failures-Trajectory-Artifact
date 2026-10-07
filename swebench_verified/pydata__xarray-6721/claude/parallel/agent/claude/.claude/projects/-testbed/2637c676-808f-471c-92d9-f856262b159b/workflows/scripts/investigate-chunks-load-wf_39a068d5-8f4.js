export const meta = {
  name: 'investigate-chunks-load',
  description: 'Investigate why accessing .chunks on a zarr-backed Dataset loads data, and find all related sites',
  phases: [
    { title: 'Investigate', detail: 'parallel readers over chunks/data access paths, tests, and duck-array helpers' },
    { title: 'Synthesize', detail: 'merge into a single fix plan' },
  ],
}

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    sites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          code: { type: 'string' },
          problem: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['file', 'line', 'code', 'problem'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['summary', 'sites'],
}

phase('Investigate')

const LENSES = [
  {
    key: 'chunks-accessors',
    prompt: `In the xarray repo at /testbed, find EVERY place in xarray/core/ where the public \`.chunks\` or \`.chunksizes\` accessor path (on Variable, DataArray, Dataset, and the get_chunksizes helper in xarray/core/common.py) touches \`.data\` / \`.values\` instead of the lazily-safe \`._data\`.

Context: GitHub issue — \`ds.chunks\` on a zarr-backed (non-dask) Dataset loads the entire array into memory. Traceback goes get_chunksizes -> hasattr(v.data, "chunks") -> Variable.data -> self.values -> np.asarray -> zarr read.

Read the actual code (xarray/core/common.py get_chunksizes, xarray/core/variable.py chunks/chunksizes/data/_data, xarray/core/dataarray.py chunks/chunksizes, xarray/core/dataset.py chunks/chunksizes). Report each offending line precisely with line numbers and an exact suggested minimal fix. Also state whether \`._data\` is always present and whether IndexVariable/other subclasses override chunks/chunksizes or _data in a way that matters.`,
  },
  {
    key: 'duck-array-helpers',
    prompt: `In the xarray repo at /testbed, read xarray/core/pycompat.py fully and report the available helpers for detecting chunked/dask/duck arrays (is_duck_dask_array, is_duck_array, DuckArrayModule, dask_array_type etc.), with exact signatures and semantics.

Then answer: for fixing \`get_chunksizes\` in xarray/core/common.py so it does NOT load data, is the idiomatic minimal fix (a) \`hasattr(v._data, "chunks")\`, (b) \`is_duck_dask_array(v._data)\`, or (c) using \`v.chunks is not None\`? Look at how the rest of xarray/core/ code guards chunk access on lazy vs dask arrays to determine which is most consistent with existing style, and whether any non-dask duck arrays (e.g. cubed-like, sparse) with a .chunks attribute are expected to be supported. Cite file:line evidence.`,
  },
  {
    key: 'lazy-load-semantics',
    prompt: `In the xarray repo at /testbed, explain precisely the difference between \`Variable._data\` and \`Variable.data\` (xarray/core/variable.py). Read the code.

Specifically answer:
1. What types can \`_data\` hold (MemoryCachedArray, LazilyIndexedArray, np.ndarray, dask array, duck arrays)? Trace through xarray/core/indexing.py wrapper classes.
2. Does accessing \`_data.chunks\` on any of the lazy wrapper classes (LazilyIndexedArray, MemoryCachedArray, CopyOnWriteArray, ExplicitlyIndexedNDArrayMixin subclasses) trigger a load or an \`__getattr__\` fallthrough that loads? Check whether those classes define \`__getattr__\`.
3. Is there any case where \`v.data\` has \`.chunks\` but \`v._data\` does NOT? (e.g. does \`.data\` ever wrap/convert into a dask array?) This determines whether swapping \`data\` -> \`_data\` in get_chunksizes could regress behaviour.
Cite file:line evidence.`,
  },
  {
    key: 'test-conventions',
    prompt: `In the xarray repo at /testbed, find where tests would go for "accessing Dataset.chunks / DataArray.chunks on a lazily-loaded (zarr / non-dask) store must NOT load data into memory".

Look at xarray/tests/test_backends.py and xarray/tests/test_dataset.py and xarray/tests/__init__.py. Report:
1. Existing test helpers/fixtures for detecting whether data was loaded — e.g. any counting/instrumented array class (search for things like "UnexpectedDataAccess", "InaccessibleArray", "source_ndarray", "AccessibleAsDuckArray", counting store, "CountingDict"). Give exact class names and file:line.
2. Existing zarr test base classes (ZarrBase, TestZarrDirectoryStore, roundtrip helpers, create_zarr_target) and how a test opens a zarr store lazily without dask (chunks=None?).
3. Existing tests named around chunks/chunksizes that this change might affect — list file:line and what they assert.
4. The most idiomatic place + style for a new regression test. Quote a short representative existing test verbatim as a template.`,
  },
  {
    key: 'callers-blast-radius',
    prompt: `In the xarray repo at /testbed, map the blast radius of changing \`get_chunksizes\` in xarray/core/common.py and \`Variable.chunksizes\` in xarray/core/variable.py.

Find every caller (grep across xarray/, including backends/, coding/, plot/, and tests/) of: get_chunksizes, .chunksizes, Dataset.chunks, DataArray.chunks, Variable.chunks. For each caller, say whether it relies on the current (loading) behaviour or would be unaffected by making it lazy. Pay attention to xarray/core/dataset.py unify_chunks, xarray/backends/*, and any repr code (xarray/core/formatting.py) that prints chunk info. Cite file:line.`,
  },
]

const findings = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `probe:${l.key}`, phase: 'Investigate', schema: FINDINGS })
))

const ok = findings.filter(Boolean)

phase('Synthesize')

const synth = await agent(`You are synthesizing an investigation into an xarray bug at /testbed.

Bug: \`ds.chunks\` on a zarr-backed Dataset (opened WITHOUT dask, i.e. lazy-loading) loads the whole array into memory, because \`xarray/core/common.py:get_chunksizes\` does \`hasattr(v.data, "chunks")\` and \`Variable.data\` materializes lazy arrays.

Here are five parallel investigation reports (JSON):

${JSON.stringify(ok, null, 2)}

Verify the key claims yourself by reading the actual files (do not trust the reports blindly — especially any claim about whether lazy indexing wrapper classes define \`__getattr__\`, and whether \`v.data\` can have \`.chunks\` when \`v._data\` does not).

Then produce a single concrete fix plan:
1. The exact minimal source edits (file, line, old code, new code) needed so that \`.chunks\`/\`.chunksizes\` never load data.
2. Whether \`Variable.chunksizes\` also needs fixing (it does \`self.data.chunks\` inside a \`hasattr(self._data, "chunks")\` guard).
3. The exact regression test(s) to add: file, test name, and full code, using the repo's existing helpers. It must fail before the fix and pass after.
4. Any whatsnew doc entry convention (check doc/whatsnew.rst for the unreleased section and format).
5. Risks / behaviours that must NOT regress.

Be concrete and cite file:line. Return the plan as markdown text.`, { label: 'synthesize', phase: 'Synthesize' })

return synth
