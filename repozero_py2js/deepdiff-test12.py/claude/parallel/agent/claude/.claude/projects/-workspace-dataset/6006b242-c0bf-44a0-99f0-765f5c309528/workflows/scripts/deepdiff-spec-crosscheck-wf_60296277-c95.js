export const meta = {
  name: 'deepdiff-spec-crosscheck',
  description: 'Independently characterize the Python deepdiff executable behavior from multiple lenses, then adversarially test a candidate rule',
  phases: [
    { title: 'Characterize', detail: 'independent black-box probing of the executable' },
    { title: 'Refute', detail: 'try to break the candidate collapse rule' },
    { title: 'Synthesize', detail: 'merge into one authoritative spec' },
  ],
}

const EXE = '/workspace/dataset/test12_executable'

const SHARED = `
You are black-box reverse-engineering a PyInstaller-compiled Python program.

Source (/workspace/dataset/deepdiff/test12.py):
---
import argparse
from deepdiff import DeepDiff

parser = argparse.ArgumentParser()
parser.add_argument('--a', type=int, required=True)
parser.add_argument('--b', type=int, required=True)
parser.add_argument('--c', type=int, required=True)
parser.add_argument('--d', type=int, required=True)
args = parser.parse_args()

obj1 = {str(i): i * args.a for i in range(args.b)}
obj2 = {str(i): i * args.c for i in range(args.d)}
obj3 = {k: v * 2 for k, v in obj1.items()}
obj4 = {k: v + 10 for k, v in obj2.items()}

r1..r10 = DeepDiff over pairs: (obj1,obj2) (obj2,obj3) (obj3,obj4) (obj1,obj3) (obj2,obj4) (obj1,obj4) (obj1,obj1) ({},obj1) (obj4,{}) (obj3,obj3)
each printed with print()
---

Run it as: ${EXE} --a <int> --b <int> --c <int> --d <int}
NOTE: each invocation takes ~0.7-1.0s (147MB binary). Batch many invocations per Bash call with a shell loop, and keep total runtime per Bash call under ~110 seconds or it will be killed. Do NOT use the 'python' command. You may NOT read deepdiff source.

Your findings will be used to write a byte-exact Node.js reimplementation, so precision matters more than breadth of prose.
`

phase('Characterize')

const LENSES = [
  {
    key: 'collapse-threshold',
    prompt: `${SHARED}

YOUR LENS: the "root collapse" rule.

Sometimes DeepDiff reports per-key results (dictionary_item_added / dictionary_item_removed / values_changed with "root['k']" paths), and sometimes it collapses to a single
  {'values_changed': {'root': {'new_value': <whole dict repr>, 'old_value': <whole dict repr>}}}

A candidate rule (derived from deepdiff's threshold_to_diff_deeper=0.33) is:

  let n1 = number of keys in t1, n2 = number of keys in t2
  intersect = keys in both, union = keys in either
  COLLAPSE iff  union.size > 1  AND  (intersect.size / union.size) < 0.33     // IEEE double compare
  otherwise report per-key diffs

Because keys are always str(0)..str(n-1), key sets are nested prefixes: intersect = min(n1,n2), union = max(n1,n2).
So the rule reduces to: COLLAPSE iff max(n1,n2) > 1 && min(n1,n2)/max(n1,n2) < 0.33.

TASK: try hard to find a counterexample. Probe (b,d) pairs across a wide range, INCLUDING exact ratio boundaries where min/max is near 0.33 (e.g. 1/3, 2/6, 3/9, 33/100, 32/100, 1/4, 2/7, 3/10, 4/12, 4/13, 5/15, 5/16, 10/30, 10/31, 33/99), plus zero/negative b or d, and asymmetric orders (b<d and b>d).
Check the rule against r1 (obj1 vs obj2), r2 (obj2 vs obj3), r3 (obj3 vs obj4), r6 (obj1 vs obj4), r8 ({} vs obj1) and r9 (obj4 vs {}) — all 6 pairs whose key counts can differ.
Also confirm r4/r5/r7/r10 (equal key sets) NEVER collapse.

Report: VERDICT (rule holds / rule broken), every counterexample with exact command + exact stdout line, and if broken, the corrected rule.`,
  },
  {
    key: 'ordering-and-repr',
    prompt: `${SHARED}

YOUR LENS: exact output text — key ordering and Python repr.

Determine with certainty:
1. Order of the top-level result keys when several are present (dictionary_item_added, dictionary_item_removed, values_changed). Find inputs producing each combination. Is any pair with BOTH added and removed possible here? (key sets are nested prefixes, so probably not — confirm.)
2. Ordering INSIDE dictionary_item_added / dictionary_item_removed lists when keys have multiple digits: is it numeric/insertion order ('9','10','11') or lexicographic string order ('10','11','9')? Test b=9 d=12, b=4 d=12, b=12 d=4, b=8 d=11, b=99 d=100 style cases and also cases needing keys past '100'.
3. Ordering INSIDE values_changed when some keys are unchanged and skipped (e.g. a=1,c=1,b=12,d=12 skips '10'). Insertion order or sorted?
4. Exact repr details: quoting of path strings ("root['0']" double-quoted vs 'root'), separators (", " vs ","), ": " after keys, empty dict as {}, nesting braces, and whether new_value always precedes old_value.
5. Whether values_changed for a collapsed root prints the FULL dict repr with keys in insertion (numeric) order.
6. Confirm there is exactly one trailing newline per print and 10 lines total on success.

Report exact verbatim stdout lines as evidence for each conclusion.`,
  },
  {
    key: 'argparse-and-bigint',
    prompt: `${SHARED}

YOUR LENS: the command-line interface and integer semantics.

Determine with certainty and quote EXACT bytes:
1. --help output (full text, exact spacing), exit code.
2. Error text + exit code for: no args; one missing required arg; two missing; missing value after --a; invalid int ('x', '1.5', '0x10', '', '3,4'); unrecognized extra arg.
3. Does '--a=5' work? Does '--a 5' work? Does prefix abbreviation matter (only long opts --a --b --c --d exist)? Does '-h' work? Does a bare '--' separator do anything?
4. Duplicate options: '--a 1 --a 7' -> which wins?
5. Python int() coercion accepted forms: leading/trailing ASCII whitespace, tabs, newlines, '+7', '-0', underscores between digits ('1_0_0'), rejected forms ('_1', '1_', '1__0'), and NON-ASCII decimal digits (Arabic-Indic '١٢', Devanagari '३', mathematical '𝟛', full-width '１２'). For each, state accepted (and resulting value) or rejected (and exact error text).
6. Arbitrary-precision integers: verify very large --a and --c (e.g. 99999999999999999999 and 12345678901234567890123) produce exact big-integer arithmetic in output with no float rounding, and confirm negative large values too.
7. Behavior with huge --b (does it just take longer? do not run anything above b=2000).
8. The program name shown in usage/error messages — is it the argv[0] basename?

Report a precise table. Quote error strings byte-exactly including the 'usage:' line.`,
  },
]

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    verdict: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidenceCommand: { type: 'string' },
          evidenceOutput: { type: 'string' },
          confidence: { type: 'string', enum: ['certain', 'likely', 'unsure'] },
        },
        required: ['claim', 'evidenceCommand', 'evidenceOutput', 'confidence'],
      },
    },
    counterexamples: { type: 'array', items: { type: 'string' } },
    rulesForImplementer: { type: 'array', items: { type: 'string' } },
  },
  required: ['lens', 'verdict', 'findings', 'rulesForImplementer'],
}

const specs = await parallel(LENSES.map(l => () =>
  agent(l.prompt, { label: `spec:${l.key}`, phase: 'Characterize', schema: SPEC_SCHEMA })))

const good = specs.filter(Boolean)

phase('Synthesize')

const merged = await agent(`You are merging three independent black-box characterizations of the same program into ONE authoritative implementation spec.

Lens reports (JSON):
${JSON.stringify(good, null, 2)}

Produce a single spec precise enough that a Node.js engineer can reproduce stdout byte-for-byte for ANY integer inputs --a --b --c --d, without ever running the Python program. Include:
- the exact root-collapse rule (with the float-comparison caveat) and where it applies
- ordering rules for every container
- the exact Python repr grammar needed (dict, str with embedded quotes, int)
- the exact argparse surface: help text, error texts, exit codes, accepted int() forms, duplicate handling
- arbitrary-precision arithmetic requirements
- any disagreement between lenses, flagged explicitly as OPEN QUESTION with the evidence on each side

Be terse and mechanical: numbered rules, no prose padding.`, { label: 'synthesize-spec', phase: 'Synthesize' })

return { merged, lensCount: good.length }
