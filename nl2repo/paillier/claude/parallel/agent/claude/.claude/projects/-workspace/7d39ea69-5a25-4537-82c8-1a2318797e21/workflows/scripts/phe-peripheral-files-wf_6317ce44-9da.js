export const meta = {
  name: 'phe-peripheral-files',
  description: 'Author docs, examples, third-party notices and repo metadata for the python-paillier reproduction in /workspace',
  phases: [
    { title: 'Docs' },
    { title: 'Examples' },
    { title: 'Meta' },
  ],
}

const CONTEXT = `
You are helping reproduce the open-source project **python-paillier** (package name \`phe\`, version 1.5.0,
by CSIRO's Data61) in the directory /workspace. It is a Partially Homomorphic Encryption library
implementing the Paillier cryptosystem, licensed GPLv3.

A reference copy of the *installed* library source is readable at
/usr/local/lib/python3.10/site-packages/phe/ (files: __about__.py, __init__.py, util.py, encoding.py,
paillier.py, command_line.py). READ IT to get the API exactly right. Do NOT modify anything under
/usr/local/lib. Do NOT create, modify or delete any file under /workspace/phe/ — another agent owns
that directory. Only write the exact files you are assigned.

Key API facts:
- \`from phe import paillier\`; \`public_key, private_key = paillier.generate_paillier_keypair(n_length=3072)\`
- \`paillier.DEFAULT_KEYSIZE == 3072\`
- \`PaillierPublicKey(n)\` with attributes g, n, nsquare, max_int; methods encrypt(value, precision=None,
  r_value=None), raw_encrypt(plaintext, r_value=None), encrypt_encoded(encoding, r_value), get_random_lt_n()
- \`PaillierPrivateKey(public_key, p, q)\` with decrypt(), decrypt_encoded(enc, Encoding=None),
  raw_decrypt(ciphertext), static from_totient(public_key, totient)
- \`PaillierPrivateKeyring(private_keys=None)\` behaves like a Mapping keyed by public key; .add(), .decrypt()
- \`EncryptedNumber(public_key, ciphertext, exponent=0)\` supports + - * / with ints, floats,
  EncodedNumber and (for +/-) other EncryptedNumbers. Multiplying two EncryptedNumbers raises
  NotImplementedError. Also ciphertext(be_secure=True), decrease_exponent_to(new_exp), obfuscate().
- \`from phe import EncodedNumber\`; EncodedNumber.encode(public_key, scalar, precision=None,
  max_exponent=None), .decode(), .decrease_exponent_to(new_exp), class attrs BASE=16, LOG2_BASE.
- \`phe.util\`: powmod, mulmod, invert, getprimeover, isqrt, improved_i_sqrt,
  extended_euclidean_algorithm, miller_rabin, is_prime, first_primes, HAVE_GMP, HAVE_CRYPTO,
  int_to_base64, base64_to_int, base64url_encode, base64url_decode.
- CLI: console script \`pheutil\` -> phe.command_line:cli, with commands genpkey, extract, encrypt,
  decrypt, addenc, add, multiply. Keys serialise as JWK-ish JSON with kty "DAJ", alg "PAI-GN1".

Style: this is a real open-source repo. Write plain, professional, accurate prose/code. No emoji,
no marketing fluff, no invented benchmarks presented as measured fact (label illustrative numbers as
illustrative). reStructuredText (.rst) for docs. Python 3 for examples.
Write real file content with the Write tool - never leave a file empty or a stub.
`

phase('Docs')

const DOC_TASKS = [
  {
    label: 'docs:index+conf',
    files: '/workspace/docs/conf.py, /workspace/docs/index.rst, /workspace/docs/Makefile, /workspace/docs/requirements.txt, /workspace/docs/_static/Magic-Logo.svg',
    detail: `
- docs/conf.py: a working Sphinx configuration. project = 'Python Paillier', copyright for CSIRO's Data61,
  author 'CSIRO Data61'. Read the version dynamically from ../phe/__about__.py using a small exec/regex so
  it does not import the package. extensions = ['sphinx.ext.autodoc', 'sphinx.ext.viewcode',
  'sphinx.ext.napoleon', 'sphinx.ext.mathjax', 'sphinx.ext.intersphinx']. html_theme = 'alabaster' with a
  try/except for sphinx_rtd_theme. master_doc = 'index'. Must be valid Python that runs standalone
  (verify with \`python3 -c "exec(open('/workspace/docs/conf.py').read())"\` from /workspace/docs).
- docs/index.rst: front page with a short project description, the toctree listing (in order)
  installation, usage, phe, serialisation, alternatives, caveats, cli, compatibility, plus
  Indices and tables section.
- docs/Makefile: standard minimal Sphinx Makefile (SPHINXOPTS/SPHINXBUILD/SOURCEDIR/BUILDDIR, help target,
  catch-all % target).
- docs/requirements.txt: sphinx, sphinx_rtd_theme, numpy (doc build deps).
- docs/_static/Magic-Logo.svg: a small, valid, self-contained SVG logo (a padlock or lambda motif is fine),
  viewBox set, no external references.`,
  },
  {
    label: 'docs:usage+phe',
    files: '/workspace/docs/usage.rst, /workspace/docs/phe.rst, /workspace/docs/installation.rst',
    detail: `
- docs/installation.rst: pip install phe, optional extras \`pip install "phe[cli]"\`, notes on gmpy2 for
  ~8x speedup on modular exponentiation, pycryptodome as an alternative source of primes, supported
  Python versions (3.7-3.11; historically 3.4+), and installing from source (\`pip install -e .\`).
- docs/usage.rst: a real tutorial with runnable doctest-style examples: key generation, encrypting ints
  and floats, precision control, homomorphic add/sub/mul/div (including scalar on either side), summing a
  list of EncryptedNumbers, the keyring, decrease_exponent_to, obfuscate, and the overflow/max_int caveat.
  Every code example must be correct against the real API.
- docs/phe.rst: API reference using sphinx autodoc: automodule directives for phe.paillier,
  phe.encoding, phe.util and phe.command_line with :members:, :undoc-members:, :show-inheritance:,
  organised under section headings.`,
  },
  {
    label: 'docs:misc',
    files: '/workspace/docs/alternatives.rst, /workspace/docs/caveats.rst, /workspace/docs/cli.rst, /workspace/docs/compatibility.rst, /workspace/docs/serialisation.rst',
    detail: `
- docs/alternatives.rst: brief survey of other homomorphic-encryption libraries (SEAL, HElib, PALISADE,
  TFHE, python-paillier's own alternatives such as the Java/Go/JS Paillier ports), with a short note on
  when partially homomorphic encryption is the right tool.
- docs/caveats.rst: the real caveats - Paillier is only additively homomorphic; multiplication is by an
  unencrypted scalar only; the exponent of an EncryptedNumber is NOT encrypted and leaks precision
  information; integers must satisfy abs(x) <= max_int (~n/3) and overflow between max_int and n-max_int
  is *detected* but wraparound beyond that is not; floats are fixed-point encoded so repeated
  multiplication grows the exponent; obfuscate() must be called before sending a derived ciphertext to
  another party; the library does not provide integrity/authentication.
- docs/cli.rst: full documentation of the \`pheutil\` command line tool - install with
  \`pip install "phe[cli]"\`, then every command (genpkey --keysize --id, extract, encrypt --output,
  decrypt --output, addenc, add, multiply) with a worked end-to-end shell session.
- docs/compatibility.rst: the on-the-wire/interop story - the number encoding (BASE 16, exponent),
  how to agree on an alternative BASE by subclassing EncodedNumber, JWK-style key representation with
  kty "DAJ" and alg "PAI-GN1", and the Python versions supported.
- docs/serialisation.rst: how to serialise public keys, private keys and encrypted numbers to JSON -
  show \`{'n': str(public_key.n)}\`, \`{'v': str(x.ciphertext()), 'e': x.exponent}\`, reconstructing with
  \`PaillierPublicKey(n=int(...))\` and \`EncryptedNumber(pk, int(v), int(e))\`, and the warning that
  ciphertext() must be called with be_secure=True (the default) before sharing.`,
  },
]

const docs = pipeline(
  DOC_TASKS,
  t => agent(`${CONTEXT}

Your assigned files: ${t.files}

Write each of them now, in full.
${t.detail}

When done, reply with one line per file: "<path>: <bytes> - <one-clause summary>".`,
    { label: t.label, phase: 'Docs', agentType: 'general-purpose' })
)

phase('Examples')

const EXAMPLE_TASKS = [
  {
    label: 'ex:alt-base+benchmarks',
    files: '/workspace/examples/alternative_base.py, /workspace/examples/benchmarks.py',
    detail: `
- examples/alternative_base.py: demonstrate subclassing EncodedNumber with a different BASE
  (e.g. BASE = 2 and BASE = 64, with LOG2_BASE = math.log(BASE, 2)), encode/encrypt with it, and decrypt
  with \`private_key.decrypt_encoded(enc, MyEncoding).decode()\`. Print a comparison of the resulting
  exponents and encoding sizes for the same value in each base.
- examples/benchmarks.py: time key generation, encryption, decryption, encrypted+encrypted addition,
  encrypted+plaintext addition and encrypted*plaintext multiplication, for a few key sizes
  (e.g. 128, 256, 512, 1024 bits by default) and print a formatted table. Report whether
  phe.util.HAVE_GMP is True. Keep the default run under ~30 seconds and allow the key sizes / number of
  repeats to be overridden from sys.argv.
Both scripts must run to completion with \`python3 <script>\` from /workspace. RUN THEM to verify
(use a small key size / few repeats when verifying) and fix anything that breaks.`,
  },
  {
    label: 'ex:federated+logreg',
    files: '/workspace/examples/federated_learning_with_encryption.py, /workspace/examples/logistic_regression_encrypted_model.py',
    detail: `
- examples/federated_learning_with_encryption.py: several hospitals jointly train a linear regression on
  the sklearn diabetes dataset (or, if scikit-learn is unavailable, on a synthetic dataset generated with
  numpy - detect this at import time and fall back gracefully) using federated gradient descent where the
  gradients are Paillier-encrypted and aggregated by an untrusted server that never sees plaintext.
  Include a Server class holding the keypair, a Client class that encrypts its local gradient, and a
  main() that compares the federated model's MSE against locally-trained baselines.
- examples/logistic_regression_encrypted_model.py: Alice trains a logistic-regression spam classifier on
  her own data and sends Bob the *encrypted* model weights; Bob scores his emails homomorphically
  (dot product of plaintext features with encrypted weights) and returns encrypted scores that only Alice
  can decrypt. Use scikit-learn if available and fall back to a small pure-numpy logistic regression and a
  synthetic dataset otherwise, so the script always runs. Print timings and verify the encrypted-score
  predictions match the plaintext ones.
Both scripts must run to completion with \`python3 <script>\` from /workspace using only numpy + phe
(scikit-learn is NOT installed here, so the fallback path is the one that must work). RUN THEM to verify
and fix anything that breaks. Keep each runtime under ~60 seconds by using a small key size such as
\`paillier.generate_paillier_keypair(n_length=1024)\` and a modest number of iterations/features.`,
  },
]

const examples = pipeline(
  EXAMPLE_TASKS,
  t => agent(`${CONTEXT}

Your assigned files: ${t.files}

Write each of them now, in full.
${t.detail}

When done, reply with one line per file: "<path>: <bytes> - <one-clause summary> - VERIFIED RUN: yes/no".`,
    { label: t.label, phase: 'Examples', agentType: 'general-purpose' })
)

phase('Meta')

const META_TASKS = [
  {
    label: 'meta:readme+changelog',
    files: '/workspace/README.rst, /workspace/CHANGELOG.rst',
    detail: `
- README.rst: the project README. Badges-free is fine. Sections: title "Python Paillier", a one-paragraph
  description, "Installation" (pip install phe, extras, gmpy2 note), "Usage" with a short worked example
  (generate keypair, encrypt two numbers, a + b, a * 3.5, decrypt), "Command line utility" pointing at
  pheutil, "Documentation" pointing at the docs/ directory and readthedocs, "Performance" (a short note
  that gmpy2 gives roughly an order-of-magnitude speedup on modular exponentiation - mark as approximate),
  "Limitations" (additive homomorphism only, scalar multiplication only), "Running the tests"
  (\`python -m pytest phe/tests\`), "Citing", and "License" (GPLv3, Copyright 2013-2019 CSIRO's Data61).
  Valid reStructuredText.
- CHANGELOG.rst: a plausible reverse-chronological changelog for versions 1.5.0, 1.4.0, 1.3.1, 1.3.0,
  1.2.3, 1.2.2, 1.2.1, 1.2.0, 1.1.0, 1.0.0 with short bullet lists of the kind of change each release
  made (1.5.0: Python 3.9 support, faster mulmod/powmod via gmpy2, PaillierPrivateKey.from_totient,
  fix for OverflowError when decoding very small numbers). Valid reStructuredText.`,
  },
  {
    label: 'meta:repo-config',
    files: '/workspace/.gitignore, /workspace/.travis.yml, /workspace/LICENSE.txt',
    detail: `
- .gitignore: standard Python repo ignores (byte-compiled files, build/dist/egg-info, .eggs, venvs,
  .pytest_cache, .tox, .coverage, htmlcov, docs/_build, IDE dirs, *.json key files produced by the CLI).
- .travis.yml: a Travis CI config for a Python library - language: python, a matrix over
  python 3.7/3.8/3.9, install step that pip-installs the package with test extras (and gmpy2),
  script step running \`python -m pytest phe/tests\`, plus a note-free clean YAML. Must be valid YAML.
- LICENSE.txt: the full, verbatim GNU General Public License version 3 text (the standard
  "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007" document, complete, including the preamble,
  all terms and conditions sections 0-17, and the "How to Apply These Terms to Your New Programs"
  appendix). Do not abbreviate or summarise it. If you can find a copy of the GPLv3 text already present
  on this machine (try \`ls /usr/share/common-licenses/\`, or grep site-packages dist-info LICENSE files),
  copy that verbatim rather than retyping it. Verify the result is at least 30000 bytes; if it is not,
  you have truncated it - fix that before finishing.`,
  },
  {
    label: 'meta:third-party',
    files: '/workspace/third_party/gmpy2/{COPYING.txt,README}, /workspace/third_party/nose/README, /workspace/third_party/numpy/{README,license.txt}, /workspace/third_party/pycrypto/{COPYRIGHT.txt,README}, /workspace/third_party/sphinx/README',
    detail: `
These files record the third-party dependencies whose licences this project must acknowledge.
- third_party/gmpy2/README: what gmpy2 is (Python bindings to GMP/MPFR/MPC), the upstream URL
  (https://github.com/aleaxit/gmpy), the version range used (>=2.0.4), why python-paillier uses it
  (fast powmod/invert/isqrt/next_prime), and that it is licensed LGPLv3.
- third_party/gmpy2/COPYING.txt: the GNU LESSER General Public License v3 header notice plus a clear
  statement that gmpy2 is distributed under LGPL-3.0-or-later and that the full LGPLv3 and GPLv3 texts
  apply; include the standard LGPLv3 "additional permissions" preamble paragraphs. Aim for the real
  LGPLv3 short-form text rather than a one-line summary.
- third_party/nose/README: what nose is (a legacy unittest extension / test runner), upstream URL
  https://github.com/nose-devs/nose, version >=1.3.4, note that it is unmaintained and that pytest is now
  the recommended runner for this project, licensed LGPL-2.1.
- third_party/numpy/README: what numpy is, upstream https://numpy.org, version >=1.9.1, used by the
  examples and by the maths tests (np.mean / np.dot over arrays of EncryptedNumber), BSD-3-Clause.
- third_party/numpy/license.txt: the verbatim NumPy BSD 3-Clause licence text (Copyright (c) 2005-2023,
  NumPy Developers. All rights reserved. ... the three standard clauses and the disclaimer). If a copy
  exists in site-packages (numpy-*.dist-info/LICENSE.txt), copy from it.
- third_party/pycrypto/README: what PyCrypto is (Python Cryptography Toolkit), that phe uses
  Crypto.Util.number.getPrime as a fallback prime source when gmpy2 is absent, that the maintained
  successor is pycryptodome (which is what is actually installed here), upstream URLs, version >=2.6.1.
- third_party/pycrypto/COPYRIGHT.txt: PyCrypto's copyright/public-domain dedication notice - the
  standard "The contents of this file are dedicated to the public domain..." statement together with the
  per-module copyright attributions to Dwayne C. Litzenberger and the note that some parts are covered
  by other permissive licences.
- third_party/sphinx/README: what Sphinx is, upstream https://www.sphinx-doc.org, that it builds the
  docs/ directory, BSD-2-Clause.
Every file must have real content; none may be empty.`,
  },
]

const metas = pipeline(
  META_TASKS,
  t => agent(`${CONTEXT}

Your assigned files: ${t.files}

Write each of them now, in full.
${t.detail}

When done, reply with one line per file: "<path>: <bytes> - <one-clause summary>".`,
    { label: t.label, phase: 'Meta', agentType: 'general-purpose' })
)

const [d, e, m] = await Promise.all([docs, examples, metas])
return { docs: d, examples: e, meta: m }
