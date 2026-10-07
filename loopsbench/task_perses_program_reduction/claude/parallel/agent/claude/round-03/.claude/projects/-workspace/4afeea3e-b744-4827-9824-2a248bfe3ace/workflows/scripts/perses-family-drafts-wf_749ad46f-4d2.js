export const meta = {
  name: 'perses-family-drafts',
  description: 'Draft + verify Vulcan, PPR, Sivand, LPR modules in isolated repo copies, then audit each against its requirement',
  phases: [
    { title: 'Draft' },
    { title: 'Audit' },
  ],
}

const COMMON = `
# Repository under test

The real repository is at /workspace. It is a Python 3 (standard library ONLY) program-reduction
framework in the Perses family. Already implemented and working (do NOT redesign these):

  reduction/token.py            Token dataclass (type, value, line, col) + Tokenizer
                                token types: KEYWORD, IDENTIFIER, NUMBER, STRING, FSTRING,
                                OPERATOR, DELIMITER, COMMENT, INDENT, NEWLINE, UNKNOWN
  reduction/tree.py             NodeType enum (KLEENE_STAR, KLEENE_PLUS, OPTIONAL, REGULAR, TOKEN)
                                SparTreeNode: rule_name, node_type, children, token, deleted;
                                methods token_count(), tokens(), to_source(), clone(),
                                all_nodes() (skips deleted), delete(), undelete(), is_deletable()
  reduction/grammar.py          Grammar, GrammarRule, RuleType, Grammar.python_simplified()
  reduction/pnf.py              PNFNormalizer, to_pnf(), python_pnf_grammar()
  reduction/parser.py           Parser(grammar).parse(source) -> SparTreeNode root ('program',
                                KLEENE_STAR). Simple statements are REGULAR nodes whose children
                                are TOKEN leaves. Compound statements are REGULAR nodes with a
                                '<kw>_header' REGULAR child (TOKEN leaves) and a 'block'
                                KLEENE_PLUS child, plus optional '<kw>_clause' children.
  reduction/property_test.py    PropertyTester(test_script, work_dir=None): .test(source)->bool
                                runs /bin/bash <script> <tmpfile>; .test_count; .reset_count()
  reduction/dd.py               DeltaDebugging (ddmin baseline over a token list)
  reduction/reducer.py          AbstractReducer ABC: property name, reduce(tree, tester)->tree
  reduction/driver.py           ReductionDriver(grammar, tester, reducers, config).reduce(source)
                                -> ReductionResult(original_tokens, reduced_tokens, num_tests,
                                reduced_source, .reduction_ratio). Fixpoint loop stops when a
                                full pass over all reducers does not lower tree.token_count().
                                It RAISES ValueError if the original source fails the property.
  reduction/config.py           Config(fixpoint, max_iterations, timeout_per_test, enable_dd_baseline)
  reduction/perses_reducer.py   The Perses algorithm plus SHARED machinery you MUST reuse:
                                  iter_all_nodes(node)                all nodes incl. deleted
                                  snapshot_deletions(node)/restore_deletions(node, snap)
                                  token_nodes(node)                   live TOKEN leaves in order
                                  parent_map(root) -> {id(child): parent}
                                  is_ancestor(candidate, node, parents)
                                  replace_node_content(node, replacement) -> undo callable
                                  NodePriorityQueue (largest subtree first; override .priority())
                                  SparTreeReducer(AbstractReducer): .grammar, .config,
                                    .tests_used, .successful_edits, ._check(tree, tester),
                                    ._try_delete(tree, nodes, tester), ._try_replace(tree, node,
                                    replacement, tester), ._split(items, n),
                                    ._ddmin_nodes(tree, elements, min_keep, tester)
                                  PersesReducer(grammar, config, max_replacement_candidates=6,
                                    min_replacement_tokens=2, token_level=False,
                                    queue_factory=None) with .compatible(), .alternatives_of(),
                                    .statement_like(), .make_queue(tree), and strategy methods
                                    _reduce_kleene_node, _delete_deletable_children,
                                    _replace_with_compatible_descendant, _reduce_token_children
  run.sh                        Bash experiment runner. Each experiment is a python3 heredoc
                                (<<'PYEOF') that prints KEY=VALUE lines. Already contains the DD
                                baseline and the Perses experiments.
  test_subjects/bug1|bug2|bug3  program.py + test.sh (AttributeError / ZeroDivisionError / IndexError)
  test_subjects/ppr_bug1        seed.py + test_seed.sh (exit 0), variant.py + test_variant.sh (TypeError)
  requirements/*.yaml           The requirement specs. READ YOURS IN FULL.
  agent_tests/                  stdlib unittest tests (run with:
                                PYTHONPATH=<repo> python3 -m unittest discover -s agent_tests -t agent_tests)

Current Perses baseline output (for reference, from run.sh):
  DD_BUG1_ORIGINAL=140 DD_BUG1_TOKENS=65 DD_BUG1_TESTS=1549
  PERSES_BUG1_ORIGINAL=140 PERSES_BUG1_TOKENS=41 PERSES_BUG1_TESTS=113
  PERSES_BUG2_ORIGINAL=192 PERSES_BUG2_TOKENS=35 PERSES_BUG2_TESTS=80
  PERSES_BUG3_ORIGINAL=226 PERSES_BUG3_TOKENS=26 PERSES_BUG3_TESTS=50

# Hard rules

1. NEVER create, modify or delete ANY file under /workspace. Not one. Work ONLY inside your own
   scratch copy. First command:  cp -a /workspace <SCRATCH>  (then cd <SCRATCH>).
2. Standard library only. Python 3.12. No third-party packages, no network.
3. Match the existing code style exactly: module docstring, \`from __future__ import annotations\`,
   type hints, Google-style docstrings with Args:/Returns:/Raises: on every public class and
   method, comments that explain WHY. Read reduction/perses_reducer.py and reduction/pnf.py first
   and imitate them. No TODOs, no placeholders, no dead code.
4. Reuse the shared machinery in reduction/perses_reducer.py (SparTreeReducer._try_delete,
   _ddmin_nodes, snapshot_deletions/restore_deletions, replace_node_content, NodePriorityQueue).
   Do not reimplement deletion bookkeeping. IMPORTANT: never call SparTreeNode.undelete() to undo
   a trial edit -- it resurrects nodes an earlier successful reduction removed. Use
   snapshot_deletions/restore_deletions.
5. You must actually RUN your code in your scratch copy until it works, and paste real output.
   Verify with:  cd <SCRATCH> && PYTHONPATH=<SCRATCH> bash run.sh
6. Keep every experiment you add to run.sh under ~90 seconds of wall clock.
7. Also write stdlib unittest tests for your modules at agent_tests/test_<name>.py in your copy and
   make the whole suite pass:
     cd <SCRATCH> && PYTHONPATH=<SCRATCH> python3 -m unittest discover -s agent_tests -t agent_tests
8. Append your experiments to run.sh in your copy AND save byte-identical copies of ONLY your
   appended section to <SCRATCH>/snippet.sh. The parent will concatenate snippet.sh files into the
   real run.sh, so snippet.sh must be self-contained bash (echo banner + python3 heredoc) that
   works when appended after the existing content of run.sh. Use <<'PYEOF' heredocs and do not
   rely on variables other than PYTHON/REPO_ROOT which run.sh already defines.
9. If you believe an existing file under reduction/ must change, do NOT silently change it: report
   it in the 'changes_to_existing_files' field with a precise diff and rationale. Prefer designing
   around it. (Small, clearly-justified changes are acceptable but must be reported.)
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'files', 'verification_output', 'tests_output', 'design_notes',
             'changes_to_existing_files', 'requirement_coverage', 'risks'],
  properties: {
    slug: { type: 'string' },
    scratch_dir: { type: 'string' },
    files: {
      type: 'array',
      description: 'Every file you created in the scratch copy, repo-relative, with a one-line summary and line count',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'summary'],
        properties: { path: { type: 'string' }, summary: { type: 'string' } },
      },
    },
    verification_output: { type: 'string', description: 'Real stdout of your experiment section (all KEY=VALUE lines)' },
    tests_output: { type: 'string', description: 'Real stdout tail of the unittest run' },
    design_notes: { type: 'string', description: 'Key design decisions and how each requirement bullet is satisfied' },
    changes_to_existing_files: { type: 'string', description: 'NONE, or precise description of required changes to pre-existing files' },
    requirement_coverage: {
      type: 'array',
      description: 'One entry per numbered bullet in the requirement yaml',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bullet', 'where', 'status'],
        properties: {
          bullet: { type: 'string' },
          where: { type: 'string' },
          status: { type: 'string', enum: ['done', 'partial', 'missing'] },
        },
      },
    },
    risks: { type: 'string' },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'verdict', 'gaps'],
  properties: {
    slug: { type: 'string' },
    verdict: { type: 'string', enum: ['ready', 'needs-work'] },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'issue', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VULCAN = `${COMMON}
# Your assignment: requirement 'vulcan_1minimality'  (read /workspace/requirements/vulcan_1minimality.yaml IN FULL)

SCRATCH = /tmp/wf/vulcan

Create:
  reduction/vulcan/__init__.py                 exports the three reducers
  reduction/vulcan/identifier_replacement.py   IdentifierReplacementReducer
  reduction/vulcan/subtree_replacement.py      SubtreeReplacementReducer
  reduction/vulcan/local_exhaustive.py         LocalExhaustiveReducer
  agent_tests/test_vulcan.py
  snippet.sh  (+ the same text appended to run.sh)

Design guidance (follow unless you find a concrete reason not to, and then say so):

* IdentifierReplacementReducer(SparTreeReducer): collect the live TOKEN leaves whose token.type is
  'IDENTIFIER'; count frequency; order most-frequent-first (stable, deterministic tie-break by
  name) so the highest-payoff renames are tried first. Generate short names 'a','b',... then
  'aa','ab',... skipping names already used in the program and Python keywords. Rename ALL
  occurrences of one identifier at once (that is one candidate = one property test), keep it if the
  property still holds, otherwise restore the old token values. Renaming does not change
  token_count, so it must not confuse the driver fixpoint loop: report your reduction via
  successful_edits and always return the tree. Provide a max_identifiers / budget knob so the test
  cost stays bounded, and skip identifiers that are obviously builtins/attributes you cannot rename
  safely ONLY if you justify it -- attempting and rejecting is also fine and more faithful.
  Beware: tokens are shared objects; mutate token.value and remember the original to restore it.

* SubtreeReplacementReducer(SparTreeReducer): for every live non-leaf node (largest first), search
  the WHOLE tree (not only descendants, unlike Perses) for live non-leaf nodes with the same
  rule_name and a strictly smaller token_count; skip candidates that are the node itself or an
  ancestor of it (use parent_map/is_ancestor); try the smallest candidates first using
  _try_replace, cap the number of candidates per node. This complements Perses which only tries
  descendants.

* LocalExhaustiveReducer(SparTreeReducer): window_size=3 and budget=200 defaults, both
  constructor args. Build the ordered list of deletable positions: the live children of
  KLEENE_STAR/KLEENE_PLUS nodes (honouring 'at least one child must survive' for KLEENE_PLUS),
  the nodes for which is_deletable() is True, AND the live TOKEN leaves (token-level windows are
  what actually pushes past Perses' statement-level 1-minimality on these subjects). Slide a
  window of size W over that list; for each window enumerate all 2^W - 1 non-empty deletion
  patterns, largest pattern first, and keep the first one that preserves the property; stop when
  the budget of property tests is exhausted. Make the enumeration deterministic. Recompute the
  position list after a successful deletion (or advance carefully) so you never reference deleted
  nodes.

* run.sh experiments: for bug1, bug2, bug3 build a ReductionDriver whose reducers list is
  [PersesReducer(grammar)] + the three Vulcan reducers (in a sensible order) with the PNF-normalized
  grammar, Config(fixpoint=True, max_iterations=20). Print the reduced program between
  '--- reduced program (Vulcan, bugN) ---' / '--- end ---' markers like the Perses section does,
  then VULCAN_BUGn_ORIGINAL, VULCAN_BUGn_TOKENS, VULCAN_BUGn_TESTS, VULCAN_BUGn_RATIO (4 decimals),
  VULCAN_BUGn_TIME. The REQUIRED keys are VULCAN_BUGn_TOKENS / VULCAN_BUGn_TESTS / VULCAN_BUGn_RATIO
  for n in 1,2,3. VULCAN_BUGn_TOKENS MUST be <= the corresponding PERSES_BUGn_TOKENS, and should be
  strictly smaller for at least one bug (that is the whole point of the paper). Tune your reducers
  until that holds. Also verify the final reduced program still passes test_subjects/bugN/test.sh
  and print VULCAN_BUGn_VALID=1.
`

const PPR = `${COMMON}
# Your assignment: requirement 'ppr'  (read /workspace/requirements/ppr.yaml IN FULL)

SCRATCH = /tmp/wf/ppr

Create a NEW TOP-LEVEL package 'ppr' (sibling of 'reduction'):
  ppr/__init__.py         exports the public API
  ppr/diff_utils.py       token_diff, line_diff, common_tokens (difflib.SequenceMatcher based)
  ppr/min_tdiff.py        MinTdiff  (tree-based diff minimization)
  ppr/min_ldiff.py        MinLdiff  (line-hunk ddmin)
  ppr/min_commonality.py  MinCommonality (delete shared tokens from both programs)
  ppr/result.py           PPRResult dataclass
  ppr/driver.py           PPRDriver
  agent_tests/test_ppr.py
  snippet.sh  (+ the same text appended to run.sh)

Design guidance:

* diff_utils.token_diff(a_tokens_or_source, b_...) -> returns the tokens unique to each program
  (both directions) computed with difflib.SequenceMatcher over comparable token keys (use
  (type, value) and ignore NEWLINE/INDENT/COMMENT noise consistently). line_diff returns the
  line-level differences (hunks) and common_tokens returns the tokens shared by both. Provide a
  diff_size()/token_diff_size() helper used for all reported diff metrics so
  PPR_DIFF_ORIGINAL and PPR_DIFF_REDUCED are computed by the SAME function.
* MinTdiff: parse both programs into SparTrees; for each node of the seed tree (largest first),
  if deleting it (a) keeps the seed's property and (b) does not increase the token diff against the
  current variant, accept; then symmetrically for the variant tree. Use SparTreeReducer machinery.
* MinLdiff: compute the line-level diff hunks between the two programs and run ddmin over the set
  of hunks, keeping a subset only when BOTH programs still satisfy their own properties. Reuse the
  ddmin partitioning idea (you may reuse SparTreeReducer._split or write a small local ddmin).
* MinCommonality: find the tokens shared by both programs; for each shared token (or group of
  identical shared tokens), try deleting it from BOTH programs simultaneously and accept only when
  BOTH properties still hold. Process largest/most-frequent first and keep a budget.
* PPRResult: dataclass with seed_original_tokens, seed_reduced_tokens, variant_original_tokens,
  variant_reduced_tokens, diff_original_tokens, diff_reduced_tokens, num_tests (total across both
  testers) plus the reduced sources and convenient ratio properties.
* PPRDriver: orchestrates Perses(seed) -> Perses(variant) -> MinTdiff -> MinLdiff ->
  MinCommonality, iterating the whole pipeline to a fixpoint (bounded max_iterations).
  CRITICAL non-degeneracy guard: the seed property here is merely 'python3 program exits 0', which
  an EMPTY program satisfies, so a naive Perses run reduces the seed to zero tokens and the whole
  pairwise notion collapses. Wrap the testers in a small PropertyTester subclass (e.g.
  NonEmptyPropertyTester / PairwiseTester in ppr/driver.py) that rejects candidates whose source
  has no tokens, and document WHY in the docstring. The wrapper must still count tests and delegate
  to the underlying tester. Result: PPR_SEED_REDUCED must be > 0.
* run.sh experiment on test_subjects/ppr_bug1: print the two reduced programs between
  '--- reduced seed (PPR) ---' / '--- end ---' and '--- reduced variant (PPR) ---' / '--- end ---',
  then the REQUIRED keys PPR_SEED_ORIGINAL, PPR_SEED_REDUCED, PPR_VARIANT_ORIGINAL,
  PPR_VARIANT_REDUCED, PPR_DIFF_ORIGINAL, PPR_DIFF_REDUCED, PPR_NUM_TESTS (plus any extra keys you
  like, e.g. PPR_ITERATIONS, PPR_SEED_VALID, PPR_VARIANT_VALID). Required invariants in your run:
  every ORIGINAL > 0, every REDUCED > 0, SEED_REDUCED <= SEED_ORIGINAL,
  VARIANT_REDUCED <= VARIANT_ORIGINAL, DIFF_REDUCED <= DIFF_ORIGINAL, NUM_TESTS > 0, and the two
  reduced programs still pass test_seed.sh / test_variant.sh respectively (assert this in the
  experiment and print the flags).
`

const SIVAND = `${COMMON}
# Your assignment: requirement 'sivand_perses'  (read /workspace/requirements/sivand_perses.yaml IN FULL)

SCRATCH = /tmp/wf/sivand

Create:
  reduction/sivand/__init__.py
  reduction/sivand/model_oracle.py        MockModel, ModelPrediction, PredictionCache, ModelOracle
  reduction/sivand/attention_priority.py  AttentionExtractor, AttentionPriorityQueue
  reduction/sivand/sivand_reducer.py      SivandReducer, IterativeAttributor, SaliencyMap,
                                          MinimalExplanation
  reduction/sivand/explanation_finder.py  ExplanationFinder, ExplanationConfig,
                                          FeatureImportanceRanker
  agent_tests/test_sivand.py
  snippet.sh  (+ the same text appended to run.sh)

Design guidance:

* ModelPrediction dataclass: label, confidence, logits (dict or tuple of per-label scores),
  attention_weights (list of floats aligned with the token list, or dict token-index -> weight).
* MockModel: deterministic, no randomness, no subprocess. predict(source) tokenizes with
  reduction.token.Tokenizer and returns 'vulnerable' when security-sensitive keywords are present
  (eval, exec, system, os, subprocess, popen, pickle, input, open, __import__ ... define the set as
  a module constant) else 'benign'. Confidence derived deterministically from the count/ratio of
  triggering tokens (documented formula, always in [0,1]). Attention weights derived from token
  type/value: KEYWORD and security-trigger tokens get high weight, IDENTIFIER medium,
  DELIMITER/OPERATOR low; normalize so weights sum to 1.0 (guard the empty case). Also implement
  batch_predict(sources) and get_feature_importance(source) (token -> aggregated importance).
* PredictionCache: SHA-256 content hash of the source as key, capacity-bounded with LRU-style
  eviction (collections.OrderedDict + move_to_end), .get/.put/.hits/.misses/.__len__/.clear.
* ModelOracle(PropertyTester): constructor takes model, target_label, optional cache/capacity and
  optional min_confidence. It must be substitutable for PropertyTester everywhere (ReductionDriver
  calls tester.test(source) and reads tester.test_count) but must NOT spawn a subprocess -- pass a
  harmless value to PropertyTester.__init__ (or override) and increment the inherited counter.
  test(source) returns True iff model prediction label == target_label (and confidence >=
  min_confidence when set). Expose .oracle_calls / .cache stats.
* AttentionExtractor: given a source (or tree) produce token-level attention weights; provide
  weights_for_tree(tree) mapping id(token-node) -> weight and node_weight(node) aggregating the
  weights of a node's live token leaves (mean and sum variants). AttentionPriorityQueue extends
  reduction.perses_reducer.NodePriorityQueue and overrides priority() so LOW-attention nodes pop
  FIRST (document why: low attention => the model relies on them least => most likely removable);
  keep a deterministic tie-break, e.g. larger subtree first among equal attention.
* SivandReducer: subclass PersesReducer. Constructor (grammar=None, config=None,
  use_attention_priority=True, oracle/extractor optional, plus the PersesReducer knobs). Override
  make_queue(tree) to return an AttentionPriorityQueue built from the tree's attention weights when
  use_attention_priority is True, else the standard queue. Because the oracle is a model and not a
  compiler, token-level reduction is allowed: default token_level=True so the minimal explanation
  can be sub-statement.
* IterativeAttributor: assigns an importance score to each token of the minimal program by removing
  it (one at a time, or in small groups) and asking the oracle whether the prediction is stable:
  removing an unimportant token keeps the label; removing an essential token flips it. Return a
  mapping token-index -> score in [0,1] and expose the number of oracle calls used.
* SaliencyMap: maps the ORIGINAL program's tokens to importance, marking each as essential
  (survived reduction / flipping the prediction when removed) or removable; provide
  essential_tokens(), removable_tokens(), sparsity() and a to_dict().
* MinimalExplanation: dataclass packaging minimal_source, prediction (ModelPrediction),
  original_tokens, minimal_tokens, oracle_calls, reduction_ratio, saliency map, plus a summary().
* ExplanationConfig dataclass: target_label override, use_attention_priority, max_iterations,
  attribution budget, cache capacity, etc. ExplanationFinder(config).explain(source) runs the
  pipeline: predict -> build ModelOracle for the predicted label -> parse -> reduce (SivandReducer
  through a ReductionDriver or directly) -> attribute -> package MinimalExplanation.
  FeatureImportanceRanker ranks tokens by derived importance (top_k(), ranked() returning
  (token, score) sorted deterministically).
* run.sh experiment: run the ExplanationFinder pipeline on test_subjects/bug1/program.py. Print the
  minimal program between '--- minimal program (Sivand, bug1) ---' / '--- end ---' then the REQUIRED
  keys SIVAND_ORIGINAL_TOKENS, SIVAND_MINIMAL_TOKENS, SIVAND_ORACLE_CALLS, SIVAND_PREDICTION,
  SIVAND_ESSENTIAL_COUNT, SIVAND_SPARSITY (4 decimals). Extra keys welcome (SIVAND_CONFIDENCE,
  SIVAND_CACHE_HITS, SIVAND_TOP_FEATURES, SIVAND_PRESERVED=1 to assert the minimal program still
  gets the same prediction). Invariants: MINIMAL_TOKENS < ORIGINAL_TOKENS, MINIMAL_TOKENS > 0,
  ORACLE_CALLS > 0, ESSENTIAL_COUNT > 0, 0 <= SPARSITY <= 1. Document precisely in the docstring and
  in a comment what SPARSITY means (define it as the fraction of the original tokens that the
  explanation drops, i.e. 1 - minimal/original).
`

const LPR = (vulcanNote) => `${COMMON}
# Your assignment: requirement 'lpr'  (read /workspace/requirements/lpr.yaml IN FULL)

SCRATCH = /tmp/wf/lpr

LPR depends on the Vulcan reducers, which a sibling agent has just drafted in /tmp/wf/vulcan.
Bootstrap with:
  mkdir -p /tmp/wf && cp -a /workspace /tmp/wf/lpr && cp -a /tmp/wf/vulcan/reduction/vulcan /tmp/wf/lpr/reduction/
and also copy over /tmp/wf/vulcan/agent_tests/test_vulcan.py and append /tmp/wf/vulcan/snippet.sh to
/tmp/wf/lpr/run.sh so your copy has a working Vulcan layer to build on. Do NOT edit the vulcan files
(if they are broken, report it in 'risks'); your snippet.sh must contain ONLY your own LPR section.
Sibling agent's Vulcan summary:
${vulcanNote}

Create:
  reduction/lpr/__init__.py
  reduction/lpr/mock_llm.py       MockLLM + the 5 deterministic regex transformations
  reduction/lpr/llm_reducer.py    LLMReducer base + 5 concrete reducers
  agent_tests/test_lpr.py
  snippet.sh  (+ the same text appended to run.sh)

Design guidance:

* mock_llm.py: a TransformationType enum (or module constants) with exactly the five names
  function_inlining, loop_unrolling, variable_elimination, data_type_elimination,
  data_type_simplification. MockLLM.transform(source, transformation) -> str | None (None or the
  unchanged source when the pattern does not apply -- pick one and be consistent, document it), plus
  a query()/complete() style entry point that mimics an LLM call (prompt in, code out) so the
  reducers read like real LLM clients, and a call counter. Every transformation is pure regex/string
  work on the source text, fully deterministic, and must produce syntactically plausible Python:
    - function_inlining: a single-return function 'def f(a, b):\\n    return EXPR' whose call sites
      'f(x, y)' can be replaced by EXPR with the parameters substituted; drop the definition when
      every call site was inlined.
    - loop_unrolling: 'for i in range(N):' with a small literal N and a simple body -> the body
      repeated N times with i replaced by the literal index (bound N, e.g. <= 4, to avoid blowup).
    - variable_elimination: 'name = <simple literal or simple expression>' used elsewhere ->
      substitute the value at the use sites and delete the assignment.
    - data_type_elimination: delete class/type definitions (and their bodies) that are never
      referenced elsewhere in the program.
    - data_type_simplification: simplify complex literals/structures to simpler equivalents
      (dict/list/set literal -> shorter literal, comprehension -> literal, f-string -> plain
      string, tuple -> single element ...). Each rewrite must be small and reversible in spirit.
  Handle the indentation of the rendered SparTree source (tokens are re-rendered with spaces around
  operators, e.g. 'empty_list = [ ]'), so your regexes must tolerate extra whitespace. Test them on
  the ACTUAL Perses-reduced sources for bug1/bug2/bug3 (run the Perses experiment to get them).
* llm_reducer.py: LLMReducer(SparTreeReducer) abstract base with an abstract/declared
  transformation attribute; reduce(tree, tester) does: source = tree.to_source() -> ask the MockLLM
  for the transformed source -> if unchanged, return the original tree -> re-parse the transformed
  source with reduction.parser.Parser (so the returned tree renders consistently) -> test the
  RE-RENDERED source with the property tester -> return the new tree if the property holds and the
  token count did not grow, otherwise return the ORIGINAL tree untouched. Count tests via _check.
  Then the five concrete subclasses, each a few lines, with a .name property
  ('LPR/FunctionInlining', ...). Share the MockLLM instance via constructor injection with a
  sensible default.
* run.sh experiment: for bug1, bug2, bug3 run a ReductionDriver whose reducers are
  [PersesReducer(grammar)] + [the five LPR reducers] + [the three Vulcan reducers]
  (import from reduction.vulcan), PNF grammar, Config(fixpoint=True, max_iterations=20). Print the
  reduced program between '--- reduced program (LPR, bugN) ---' / '--- end ---' then the REQUIRED
  keys LPR_BUGn_TOKENS, LPR_BUGn_TESTS, LPR_BUGn_RATIO (4 decimals) plus LPR_BUGn_ORIGINAL,
  LPR_BUGn_TIME, LPR_BUGn_VALID=1 (assert the reduced program still passes test.sh). Invariants:
  LPR_BUGn_TOKENS <= VULCAN_BUGn_TOKENS for every n, and strictly smaller for at least one n
  (otherwise the LLM layer is doing nothing -- fix your transformations until it bites).
`

phase('Draft')

function audit(slug, scratch, draftSummary) {
  return agent(
    `You are auditing a DRAFT implementation of requirement '${slug}' for the program-reduction
framework described below. The draft lives in ${scratch} (a full copy of /workspace plus the new
files). NEVER modify anything under /workspace; you may read/run anything in ${scratch} but do not
edit the draft either -- your job is to report, not to patch.

Do this:
1. Read /workspace/requirements/${slug}.yaml in full, sentence by sentence, and build a checklist of
   every single deliverable and behaviour it names (including exact file paths, exact class/function
   names, exact run.sh KEY names).
2. Read every new file in the draft and check each checklist item off. Flag anything missing,
   renamed, stubbed, or only superficially implemented.
3. Run the draft yourself to confirm the claimed output is real:
     cd ${scratch} && PYTHONPATH=${scratch} bash run.sh 2>&1 | tail -80
     cd ${scratch} && PYTHONPATH=${scratch} python3 -m unittest discover -s agent_tests -t agent_tests
   Confirm the required KEY=VALUE lines appear and the invariants stated in the requirement hold.
4. Adversarially look for correctness bugs: undo/restore bugs (undelete() resurrecting previously
   deleted nodes), stale node references after deletion, non-determinism (dict/set iteration order,
   hash(), time, random), unbounded test budgets, exceptions on empty input, reducers that mutate a
   tree they then discard, property tests run on a source different from the one finally returned,
   silently swallowed exceptions, style deviations from reduction/perses_reducer.py (missing
   docstrings/type hints).
5. Report a verdict and a list of concrete gaps with a specific fix for each. Be precise and
   terse; the parent agent will apply the fixes. Do not report style nits as blockers.

Draft author's own summary:
${draftSummary}
`,
    { label: `audit:${slug}`, phase: 'Audit', schema: AUDIT_SCHEMA }
  )
}

const chains = [
  // Vulcan must finish before LPR can start (LPR consumes the Vulcan reducers).
  async () => {
    const vulcan = await agent(VULCAN, { label: 'draft:vulcan', phase: 'Draft', schema: SCHEMA })
    const note = vulcan ? JSON.stringify({ files: vulcan.files, design_notes: vulcan.design_notes,
                                           verification_output: vulcan.verification_output }) : 'DRAFT FAILED'
    const rest = await parallel([
      () => audit('vulcan_1minimality', '/tmp/wf/vulcan', note),
      async () => {
        const lpr = await agent(LPR(note), { label: 'draft:lpr', phase: 'Draft', schema: SCHEMA })
        const lprNote = lpr ? JSON.stringify({ files: lpr.files, design_notes: lpr.design_notes,
                                               verification_output: lpr.verification_output }) : 'DRAFT FAILED'
        const lprAudit = await audit('lpr', '/tmp/wf/lpr', lprNote)
        return { draft: lpr, audit: lprAudit }
      },
    ])
    return { vulcan: { draft: vulcan, audit: rest[0] }, lpr: rest[1] }
  },
  async () => {
    const draft = await agent(PPR, { label: 'draft:ppr', phase: 'Draft', schema: SCHEMA })
    const note = draft ? JSON.stringify({ files: draft.files, design_notes: draft.design_notes,
                                          verification_output: draft.verification_output }) : 'DRAFT FAILED'
    return { ppr: { draft, audit: await audit('ppr', '/tmp/wf/ppr', note) } }
  },
  async () => {
    const draft = await agent(SIVAND, { label: 'draft:sivand', phase: 'Draft', schema: SCHEMA })
    const note = draft ? JSON.stringify({ files: draft.files, design_notes: draft.design_notes,
                                          verification_output: draft.verification_output }) : 'DRAFT FAILED'
    return { sivand: { draft, audit: await audit('sivand_perses', '/tmp/wf/sivand', note) } }
  },
]

const results = await parallel(chains)
return results.filter(Boolean)
