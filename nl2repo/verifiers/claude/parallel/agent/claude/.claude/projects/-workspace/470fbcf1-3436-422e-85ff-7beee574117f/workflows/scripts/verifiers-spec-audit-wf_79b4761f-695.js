export const meta = {
  name: 'verifiers-spec-audit',
  description: 'Audit the /workspace verifiers implementation against the project spec and adjacent-version test suites',
  phases: [
    { title: 'Audit' },
    { title: 'Verify' },
  ],
}

const CONTEXT = `
You are auditing a Python project at /workspace. It is an implementation of the "verifiers" library
(LLM RL / verifiable environments), matching upstream willccbb/verifiers tag v0.1.3.post0.

Reference material available READ-ONLY on this machine:
  - /workspace                       <- the implementation under audit (DO NOT MODIFY ANY FILE)
  - /tmp/vfrepo                      <- git clone of upstream willccbb/verifiers, currently at tag v0.1.3.post0
  - /tmp/vf_all/ex/verifiers-VER/    <- extracted sdists for versions 0.1.3.post0, 0.1.4, 0.1.5.post0,
                                        0.1.6.post0, 0.1.7.post0, 0.1.8.post2, 0.1.9.post3, 0.1.10, 0.1.11,
                                        0.1.12, 0.1.14, 0.2.1, 0.3.0 (each contains verifiers/ and tests/)

The project spec that the implementation must satisfy is a natural-language description plus an
"API Usage Guide" that documents these signatures (NOTE: some of these were written against a LATER
upstream version than v0.1.3.post0, so the current code may legitimately lack them):

  Parser: __init__(extract_fn=lambda x: x), parse(text)->Any, parse_answer(completion)->str|None,
          get_format_reward_func()->Callable, get_assistant_messages/get_system_messages/
          get_user_messages/get_tool_messages(completion)->list[ChatMessage]
  XMLParser(Parser): __init__(fields: list of str or tuple, answer_field="answer", extract_fn=...)
  ThinkParser(Parser): __init__(extract_fn=...), parse(text)->str
  Rubric: __init__(funcs=None, weights=None, parser=None, parallelize_scoring=True, **kwargs)
          async score_rollout(prompt, completion, answer, state, task="default", info=None, example_id=None, **kwargs)->RolloutScore
          async score_rollouts(prompts, completions, answers, states, tasks, infos, example_ids=None,
                               max_concurrent=-1, use_tqdm=True, **kwargs)->RolloutScores
          async call_reward_func(func, prompt, completion, answer, state, task="default", info=None, example_id=None, **kwargs)->float
          get_reward_func_names/get_reward_funcs/get_reward_weights/add_reward_func(func, weight=1.0)
  RubricGroup(Rubric): __init__(rubrics: list of Rubric, **kwargs); score_rollouts(same as Rubric)
  MultiTurnEnv(Environment): __init__(max_turns=-1, **kwargs); async is_completed(messages, state, **kwargs)->bool;
          abstractmethod async env_response(messages, state, **kwargs)->tuple of (Messages, State);
          async setup_state(state, **kwargs)->State; spec examples also call self.max_turns_reached(state) with await
  SingleTurnEnv(MultiTurnEnv): async is_completed(...), async env_response(...)
  ToolEnv(MultiTurnEnv): __init__(tools=None, max_turns=10, error_formatter=lambda e: str(e), **kwargs)
  EnvGroup(Environment): __init__(envs, env_names=None, **kwargs); plus EnvGroupRubric in verifiers/envs/env_group.py
  Environment.evaluate(client, model, sampling_args=None, num_examples=-1, rollouts_per_example=1,
          score_rollouts=True, max_concurrent=-1, max_concurrent_generation=None, max_concurrent_scoring=None,
          interleave_scoring=True, results_path=None, state_columns=None, save_every=-1, **kwargs)->GenerateOutputs
  Environment.generate(inputs, client, model, sampling_args=None, num_examples=None, rollouts_per_example=None,
          score_rollouts=True, max_concurrent=-1, max_concurrent_generation=None, max_concurrent_scoring=None,
          semaphore=None, generation_semaphore=None, scoring_semaphore=None, interleave_scoring=True,
          results_path=None, state_columns=None, save_every=-1, use_tqdm=True, **kwargs)->GenerateOutputs
  Environment.process_env_results_vllm(prompts, completions, states, rewards, processing_class,
          max_seq_len=-1, mask_env_responses=False, mask_truncated_completions=False,
          zero_truncated_completions=False, message_type="chat")->ProcessedOutputs  (alias process_env_results)
  Environment.make_dataset(results)->Dataset ; get_dataset/get_eval_dataset/format_dataset
  format_dataset must produce columns like question, answer, example_id, prompt per the spec.
  verifiers/__init__.py must export: Parser, XMLParser, ThinkParser, Environment, SingleTurnEnv,
          MultiTurnEnv, Rubric, RubricGroup, EnvGroup (and more).
  tests/ must contain test_parser.py, test_xml_parser.py, test_think_parser.py, test_rubric.py,
          test_rubric_group.py, test_singleturn_env.py, test_multiturn_env.py, test_env_group.py and a
          mock_openai_client.py with a MockAsyncOpenAI class (add_chat_response, add_text_response,
          set_default_responses, base_url attribute, works for chat + completion modes, no API key needed).
  pyproject.toml must declare all deps and support "pip install -e .[all]" with extras all/dev/train/jupyter/envs/docs.

HARD CONSTRAINT: the current /workspace tests (156 tests, "python -m pytest tests/ -q" from /workspace)
all pass today. Any change you recommend MUST NOT break them. The grader will run an "official" test
suite that is most likely /workspace/tests as it stands (derived from upstream v0.1.3.post0), so
v0.1.3.post0 behaviour is authoritative whenever it conflicts with the newer signatures above.

Your job is ANALYSIS ONLY. Do not edit, create, or delete any file anywhere under /workspace. You may run
read-only shell commands (grep, python -c) and you may copy /workspace into your own scratch directory
under /tmp and experiment there. Return precise, minimal, concrete recommendations.
`

const REC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: 'Two or three sentences: overall state of the audited area.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'detail', 'recommendation', 'breaks_existing_tests'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'repo-relative path, with :line when known' },
          severity: { type: 'string', enum: ['blocker', 'important', 'nice-to-have'] },
          detail: { type: 'string', description: 'What is missing/wrong vs the spec, with evidence' },
          recommendation: { type: 'string', description: 'Exact code-level change to make (may include a code snippet)' },
          breaks_existing_tests: { type: 'string', enum: ['no', 'yes', 'unknown'], description: 'Whether applying it would break the current 156 passing tests' },
        },
      },
    },
  },
}

phase('Audit')

const AREAS = [
  {
    key: 'parsers',
    prompt: `Audit /workspace/verifiers/parsers/ (parser.py, think_parser.py, xml_parser.py) and their exports.
Check every method in the spec Parser / XMLParser / ThinkParser signatures exists with the documented
behaviour, including: Parser(**kwargs) setting arbitrary attributes; parse_answer on both str and chat
completions; get_format_reward_func; get_assistant/system/user/tool_messages; XMLParser field aliases
(tuple fields), answer_field, duplicate-field ValueError, non-str field TypeError, format(), get_fields(),
parse(text, strip=True/False); ThinkParser stripping think tags and applying extract_fn.
Also verify the docstrings document input/output formats and data types (the spec demands detailed docstrings).
Read /workspace/tests/test_parser.py, test_xml_parser.py, test_think_parser.py to see what is asserted.`,
  },
  {
    key: 'rubrics',
    prompt: `Audit /workspace/verifiers/rubrics/ (rubric.py, rubric_group.py, judge_rubric.py, math_rubric.py,
tool_rubric.py, utils/math_utils.py). Verify against the spec Rubric / RubricGroup API, including
call_reward_func argument auto-detection, score_rollout, score_rollouts (max_concurrent, use_tqdm,
example_ids), get_reward_func_names/funcs/weights, add_reward_func (RubricGroup must add to the FIRST
rubric), and RubricGroup aggregation of names/funcs/weights and metric summing for duplicate names.
Two spec-documented parameters are ABSENT in the current code: example_id on call_reward_func /
score_rollout and example_ids / use_tqdm on score_rollouts. Determine exactly how to add them without
changing the result of /workspace/tests/test_rubric.py::TestRubric::test_call_reward_func_with_var_kwargs
which asserts a reward func declaring only (completion, **kwargs) receives EXACTLY 6 kwargs
(parser, prompt, answer, state, task, info). Propose a scheme where example_id is accepted and forwarded
only when the reward function explicitly names it. Also check whether RubricGroup.score_rollout and
score_rollouts use each contained rubric own parser (upstream 0.1.4 added a test for that) and how to fix
it if not.`,
  },
  {
    key: 'envs-core',
    prompt: `Audit /workspace/verifiers/envs/multiturn_env.py, singleturn_env.py, tool_env.py,
stateful_tool_env.py, textarena_env.py, env_group.py against the spec MultiTurnEnv / SingleTurnEnv /
ToolEnv / EnvGroup / EnvGroupRubric API. Confirm: max_turns semantics (-1 default and limit enforcement),
which methods are abstract, setup_state, rollout flow for chat vs completion message types, state keys
produced (responses, answer, turn, prompt, timing, etc.), EnvGroup task routing and dataset
concatenation with a task column, EnvGroupRubric behaviour. The spec MultiTurnEnv example awaits
self.max_turns_reached(state) which does not exist in this version - say exactly how to add it
(as documented sugar) without changing existing behaviour. Read /workspace/tests/test_multiturn_env.py,
test_singleturn_env.py, test_env_group.py to see what is asserted.`,
  },
  {
    key: 'environment-generate',
    prompt: `Audit /workspace/verifiers/envs/environment.py. Compare its evaluate(), generate(),
rollout, format_dataset(), get_dataset(), get_eval_dataset(), make_dataset(),
process_env_results_vllm() (and the process_env_results alias) against the spec signatures
quoted in the context above. List every parameter the spec documents that is missing from the current
signatures, and for each say exactly how to add it in a backwards-compatible way (default value +
behaviour) so that no current test changes result. Pay attention to: interleave_scoring, save_every,
results_path, state_columns, max_concurrent_generation, max_concurrent_scoring, generation_semaphore,
scoring_semaphore, use_tqdm, example_ids, and format_dataset adding an example_id column
(spec says formatted dataset columns are question, answer, example_id, prompt).
For the example_id column, determine empirically (by copying /workspace to your own /tmp scratch dir,
patching the copy, and running pytest there) whether adding it breaks any of the 156 tests, and report the
exact result. Also check that verifiers/__init__.py lazy-import machinery keeps "import verifiers" working
with torch/transformers/trl/vllm ABSENT (they are not installed here).`,
  },
  {
    key: 'packaging-tests',
    prompt: `Audit /workspace/pyproject.toml, MANIFEST.in, .pre-commit-config.yaml, .readthedocs.yaml,
docs/, and /workspace/tests/ (conftest.py, mock_openai_client.py, the 8 spec-named test files).
The spec requires pyproject.toml to declare these dependency sets (verbatim from the spec):
  main: openai, datasets, pytest>=8.4.1, pytest-asyncio>=0.23.8, pytest-cov>=6.2.1
  all: pre-commit, setuptools, pytest>=7.0.0, pytest-asyncio>=0.21.0, pytest-cov>=4.0.0, sphinx,
         myst-parser, sphinx-rtd-theme, requests, torch>=2.7.0, transformers, accelerate>=1.4.0, deepspeed,
         peft, wandb, rich, trl>=0.17.0, vllm>=0.9.2, liger-kernel>=0.5.10, nest-asyncio>=1.6.0, ipykernel,
         ipywidgets, math-verify>=0.8.0, duckduckgo-search, brave-search, reasoning-gym, smolagents>=1.15.0,
         textarena, nltk
  dev: ruff, pre-commit, setuptools, requests, pytest>=7.0.0, pytest-asyncio>=0.21.0, pytest-cov>=4.0.0,
         sphinx, myst-parser, sphinx-rtd-theme
  train: torch>=2.7.0, transformers, accelerate>=1.4.0, peft, wandb, rich, trl>=0.17.0, vllm>=0.9.2,
         liger-kernel>=0.5.10, deepspeed
  jupyter: nest-asyncio>=1.6.0, ipykernel, ipywidgets
  envs: math-verify==0.8.0, requests, duckduckgo-search, brave-search, reasoning-gym, smolagents>=1.15.0,
         textarena, nltk
  docs: sphinx, sphinx-rtd-theme, myst-parser
while the current file uses the upstream v0.1.3.post0 sets (hatchling build backend, base deps
openai/datasets/pydantic/jinja2/rich/textual/openai-agents, extras all/dev/docs/train/envs with furo).
Key risks to analyse: (1) the test suite is async and REQUIRES pytest asyncio_mode set to auto - confirm it
is set and that it survives whatever pyproject you recommend; (2) "pip install -e ." must succeed in THIS
environment - run "pip list" to see what is installed, and check whether the build backend (hatchling vs
setuptools) is already available offline; (3) which base dependencies are actually imported at runtime by
verifiers/ (grep the imports) so none is dropped. Recommend the exact final pyproject.toml content
(as a complete code block) that satisfies the spec while keeping the tests runnable, and note anything in
tests/ or docs/ that the spec requires but is missing.`,
  },
  {
    key: 'crossversion-compat',
    prompt: `Determine how robust /workspace is to the grader using a slightly different version of the
"official" test suite. For each of the upstream versions 0.1.4 and 0.1.5.post0 and 0.1.6.post0:
copy /workspace (source only) into your own scratch dir under /tmp, drop in that version tests/
directory, and run only these files: test_parser.py test_xml_parser.py test_think_parser.py test_rubric.py
test_rubric_group.py test_singleturn_env.py test_multiturn_env.py test_env_group.py.
Report per-version pass/fail counts and the exact failing test ids with the reason.
Then produce a ranked list of minimal changes to /workspace that would raise those numbers WITHOUT
breaking any of the 156 currently-passing /workspace tests. Explicitly flag any change that is impossible
to satisfy in both directions (a genuine conflict) and state which side v0.1.3.post0 is on.
Known starting points to check: StatefulToolEnv and MaybeThinkParser and ToolCallError and stop
are imported from the top-level verifiers package by later conftest.py files; the RubricGroup
per-rubric-parser test; states carrying a timing dict.`,
  },
  {
    key: 'examples-envs',
    prompt: `Audit /workspace/environments/ (20 environment packages), /workspace/examples/ (grpo training
scripts + sft.py), /workspace/configs/, /workspace/notes/, /workspace/docs/ and /workspace/README.md for
internal consistency with the verifiers API actually implemented in /workspace/verifiers/.
For every python file in environments/ and examples/, statically check that the names it imports from
verifiers (and from verifiers submodules) actually exist, and that any Environment subclass it defines
implements the abstract methods. Do NOT try to install or run them (they need network/datasets/optional
deps). Report any reference to an API that does not exist in this version.
Also assess whether the repo satisfies the spec requirement to "provide typical use cases and evaluation
scripts demonstrating how to use classes such as Parser, Rubric, and SingleTurnEnv for parsing, reward
calculation, environment interaction, and evaluation" - say concretely what file(s) should be added and
what they should contain (an outline is enough).`,
  },
]

const audits = await parallel(
  AREAS.map((a) => () =>
    agent(`${CONTEXT}\n\n### YOUR AREA: ${a.key}\n${a.prompt}`, {
      label: `audit:${a.key}`,
      phase: 'Audit',
      schema: REC_SCHEMA,
    }).then((r) => ({ area: a.key, ...(r || {}) }))
  )
)

phase('Verify')

const ok = audits.filter(Boolean)
const digest = ok
  .map((a) => `## ${a.area}\n${a.summary}\n` + (a.findings || [])
    .map((f) => `- [${f.severity}] ${f.title} (${f.file}) breaks_tests=${f.breaks_existing_tests}\n  detail: ${f.detail}\n  fix: ${f.recommendation}`)
    .join('\n'))
  .join('\n\n')

const critic = await agent(
  `${CONTEXT}\n\nBelow are audit reports from six independent auditors of /workspace. Your job is to be the
completeness critic and adjudicator. (a) Identify recommendations that CONFLICT with each other or with the
hard constraint that the current 156 tests must keep passing, and rule on each. (b) Identify anything the
auditors MISSED: an unchecked spec requirement, an unverified claim, a file the spec demands that nobody
looked for. (c) Output a single ranked, de-duplicated action list, most valuable first, where each item is
safe to apply mechanically. Verify at least the three highest-impact claims yourself with read-only
commands before endorsing them; mark each item as VERIFIED or UNVERIFIED.\n\n${digest}`,
  { label: 'critic:adjudicate', phase: 'Verify' }
)

return { audits: ok, critic }
