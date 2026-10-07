export const meta = {
  name: 'probe-bidict-test8',
  description: 'Exhaustively probe test8_executable behavior to build an exact port spec',
  phases: [
    { title: 'Probe', detail: 'parallel probe agents, one per behavioral dimension' },
    { title: 'Critic', detail: 'completeness critic finds unprobed surface' },
    { title: 'Gap', detail: 'probe the gaps the critic named' },
  ],
}

const EXE = '/workspace/dataset/test8_executable'

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          case: { type: 'string', description: 'exact command line args used' },
          stdout: { type: 'string', description: 'exact stdout, \\n for newlines' },
          stderr: { type: 'string', description: 'exact stderr, \\n for newlines' },
          rc: { type: 'integer' },
          rule: { type: 'string', description: 'the general rule this case proves, stated precisely enough to implement' },
        },
        required: ['case', 'stdout', 'stderr', 'rc', 'rule'],
      },
    },
    implementationNotes: { type: 'string', description: 'precise algorithmic rules a porter must implement for this dimension' },
  },
  required: ['dimension', 'findings', 'implementationNotes'],
}

const COMMON = `You are reverse-engineering a PyInstaller-frozen Python program to port it to Node.js.

The executable is at ${EXE}. Run it with Bash. NEVER use the \`python\` command; only run the executable.
The Python source it was built from is:

\`\`\`python
import argparse
from bidict import bidict

parser = argparse.ArgumentParser()
parser.add_argument('--k1', type=str, required=True)
parser.add_argument('--v1', type=int, required=True)
parser.add_argument('--k2', type=str, required=True)
parser.add_argument('--v2', type=int, required=True)
parser.add_argument('--k3', type=str, required=True)
parser.add_argument('--v3', type=int, required=True)
args = parser.parse_args()

b = bidict()
b[args.k1] = args.v1
b[args.k2] = args.v2
b[args.k3] = args.v3
print(b)
print(b[args.k1])
print(b.inv[args.v2])
print(b.inv[args.v3])
b[args.k1] = 999
print(b)
\`\`\`

IMPORTANT method notes:
- Capture stdout and stderr SEPARATELY so you know which stream each line goes to. Example:
  \`${EXE} --k1 a --v1 1 --k2 b --v2 2 --k3 c --v3 3 >/tmp/o.txt 2>/tmp/e.txt; echo "RC=$?"; echo "--STDOUT--"; cat -A /tmp/o.txt; echo "--STDERR--"; cat -A /tmp/e.txt\`
  (use \`cat -A\` or \`od -c\` when whitespace/newlines/escapes matter, so you see exact bytes)
- Use single-quoted shell args to pass literal quotes/backslashes safely, or use printf/env tricks for exotic bytes.
- Already-established baseline facts (do not re-derive, build on them):
  * Normal run prints 5 lines: repr(b), b[k1], b.inv[v2], b.inv[v3], repr(b-after-update).
  * repr format: \`bidict({'i': 55, 'c': 95, 't': 92})\`
  * Setting a NEW key to an ALREADY-PRESENT value -> stderr traceback ending \`bidict.ValueDuplicationError: <value>\`, rc=1.
  * Setting an EXISTING key to a value already held by a DIFFERENT key -> \`bidict.KeyAndValueDuplicationError: ('<key>', <value>)\`, rc=1.
  * Setting an existing key to the value it ALREADY has -> no error, no-op.
  * Re-assigning an existing key a fresh value keeps that key's ORIGINAL insertion position.
  * Missing required args -> usage + \`test8_executable: error: the following arguments are required: --v1, --k2, ...\` on stderr, rc=2.
  * Bad int -> \`test8_executable: error: argument --v1: invalid int value: 'x'\`, rc=2.
  * Negative values like \`--v1 -5\` parse fine.

Report EXACT bytes. Your final output is consumed by a porter who cannot run the executable, so be exhaustive and literal. Quote exact strings.`

const DIMENSIONS = [
  {
    key: 'argparse-errors',
    prompt: `Dimension: **argparse error & usage surface**.
Probe exhaustively and report exact stderr text + rc:
- The exact usage line and full --help / -h output (byte exact, including indentation and blank lines). Also \`-h\` alone, and \`--help\` combined with other args, and \`--help\` when required args are missing. Does help go to stdout or stderr? rc?
- Missing-required-arg message for MANY different subsets (missing one, missing several, missing all, none provided at all). Confirm the ORDER the missing args are listed in and the exact separator (", ").
- Unrecognized arguments: \`--bogus x\`, a bare positional \`foo\`, extra positionals, \`--k1 a extra\`. Exact message and rc.
- \`--k1\` with no following value ("expected one argument").
- \`--k1=value\` equals-syntax. Does it work? What about \`--v1=-5\`, \`--k1=\` (empty)?
- Prefix abbreviation: try \`--k\`, \`--v\`, \`--k1x\`, and any unambiguous abbreviations. Report exact "ambiguous option" messages.
- Repeated same option: \`--k1 a --k1 b\` (last wins?).
- \`--\` separator handling: \`-- --k1 a\`, and \`--k1 -- a\`.
- An option-looking value: \`--k1 --v1\` , \`--k1 -x\`, \`--k1 -5\`, \`--k1 -\`.
- Empty argv (no args at all).
- Combination: unrecognized arg AND missing required arg — which error wins?
- Does the error message use the program name \`test8_executable\` always? What if invoked via a symlink/different argv[0]? (test by copying or symlinking the exe to /tmp/othername and running it — report whether prog name follows argv[0]).`,
  },
  {
    key: 'int-parsing',
    prompt: `Dimension: **Python \`int(str)\` coercion semantics as used by argparse type=int**.
For each candidate string, run it as --v1 and report whether it parses and to what, or the exact error message. Report the exact repr shown in \`invalid int value: '...'\` (note how the offending string is repr'd — try strings containing quotes/backslashes/newlines/unicode to see the repr escaping).
Candidates to test at minimum:
- \`5\`, \`+5\`, \`-5\`, \`  7  \` (surrounding spaces), \`\\t8\\n\` (tab/newline padding), \`\` (empty string), \`   \` (only spaces)
- \`007\`, \`0\`, \`-0\`
- \`1_000\`, \`1__0\` (double underscore), \`_1\`, \`1_\`
- \`0x10\`, \`0b11\`, \`0o17\`, \`1e5\`, \`5.0\`, \`5.\`, \`inf\`, \`nan\`
- huge integers: \`99999999999999999999999999\` (30+ digits) — does it work? What does it print in the repr and for \`b[k1]\`? Does JS Number lose precision here? Report the exact printed digits.
- \`999\` specifically (interacts with the update step)
- unicode digits: Arabic-Indic \`٥\` (U+0665), Devanagari \`५\` (U+096F), fullwidth \`５\` (U+FF15), superscript \`²\`, and \`Ⅴ\` (Roman numeral). Which does Python int() accept? Use printf/bash $'\\u...' to emit them.
- unicode whitespace padding: NBSP (U+00A0), U+2007, U+3000 around a digit — accepted as whitespace by int()?
- \`--v1 5 --v2 5.0\`? (each of v1,v2,v3 uses the same type — confirm all three behave identically and the error names the right option)
State a precise, implementable algorithm for a JS reimplementation of Python's int() for this input space, including which characters count as strippable whitespace and how underscores are validated.`,
  },
  {
    key: 'repr-formatting',
    prompt: `Dimension: **exact \`repr()\` formatting of the bidict and of printed values**.
The port must byte-match \`print(b)\`. Probe:
- Key strings needing repr escaping. For each, report the exact printed line: a key containing a single quote (\`it's\`), a double quote (\`say"hi"\`), BOTH a single and double quote, a backslash (\`a\\\\b\`), a newline, a tab, a carriage return, a NUL-ish/control char (e.g. \$'\\x01', \$'\\x7f'), an empty string key \`''\`.
- Non-ASCII keys: \`é\`, \`中文\`, an emoji (\`🎉\`), a combining char, an astral-plane char. Does Python repr escape them or print them raw? (Python 3 repr keeps printable non-ASCII raw but escapes non-printable — verify precisely, including unusual categories like U+00AD SOFT HYPHEN, U+200B ZERO WIDTH SPACE, U+2028 LINE SEPARATOR, U+0378 unassigned, U+E000 private use, U+FEFF, and a lone surrogate if you can pass one.)
- How are the plain \`print(b[k1])\` / \`print(b.inv[v2])\` lines formatted vs the repr lines? (str() not repr() — confirm a key with a quote prints RAW on those lines but escaped inside the bidict repr.)
- Confirm the separator is exactly \`, \` and the mapping is \`'key': value\` with one space after the colon.
- Multi-byte / long content: any line wrapping? (there must be none.)
- What does the repr look like if the bidict ends up with fewer than 3 entries (duplicate keys collapse it)? e.g. all three keys equal -> 1 entry. And confirm there's no trailing comma.
Give the porter a precise spec of Python's \`repr()\` for str (which chars escaped, which escape form: \\xNN vs \\uNNNN vs \\UNNNNNNNN, and the quote-selection rule) and for int.`,
  },
  {
    key: 'bidict-semantics',
    prompt: `Dimension: **bidict duplication/ordering semantics for this exact 4-write sequence**.
Enumerate systematically all the ways the 3 keys and 3 values can collide, and for each report exact stdout, stderr, rc. Cover at minimum:
- All key-equality patterns: k1=k2≠k3, k1=k3≠k2, k2=k3≠k1, k1=k2=k3, all distinct.
- Crossed with value-equality patterns: v1=v2, v1=v3, v2=v3, v1=v2=v3, all distinct.
- Specifically nail down: when a duplicate KEY write happens (b[k]=newval for existing k), what happens to the OLD value — is it fully removed from the inverse? Prove it by then trying to read the old value from b.inv.
- Insertion-ORDER rules: after \`b[k1]=999\` updates an existing key, where does it appear in the repr? Confirm with cases where k1 was written 1st vs where k1 got re-written at step 2 or 3.
- Cases where the k2=k3 collision makes \`b.inv[v2]\` a KeyError: report the EXACT traceback text (all lines, byte exact, including the \`~^^^\` caret lines and the \`[PYI-NNN:ERROR]\` trailer) and rc. Note whether the PYI number varies run to run.
- Same for \`b.inv[v3]\` KeyError and \`b[k1]\` KeyError (is b[k1] KeyError even reachable?).
- The three error classes' exact final traceback line: ValueDuplicationError, KeyAndValueDuplicationError, KeyDuplicationError (is KeyDuplicationError reachable at all via __setitem__? explain).
- What is the exact value shown after \`ValueDuplicationError: \` — is it repr of the value? Test with a huge int and a negative int.
- What is shown for KeyAndValueDuplicationError — a tuple repr \`('a', 999)\`? Test with a key needing repr escaping (quote/newline/unicode) to pin the formatting.
- Does the 999 update ever cause ValueDuplicationError (not KeyAndValue)? Reason about whether k1 can be absent at that point — test if so.
Deliver a precise decision table an implementer can encode: given (key present?, value present?, same entry?) -> action or exception.`,
  },
  {
    key: 'traceback-format',
    prompt: `Dimension: **exact stderr traceback bytes for every reachable exception**.
For each reachable failure mode, capture the FULL stderr byte-exactly (use \`cat -A\` and \`od -c\` to confirm trailing newlines and no trailing spaces) and the rc:
1. ValueDuplicationError at \`b[args.k2] = args.v2\` (line 16)
2. ValueDuplicationError at \`b[args.k3] = args.v3\` (line 17)
3. KeyAndValueDuplicationError at \`b[args.k1] = 999\` (line 26)
4. Any KeyError from \`b.inv[args.v2]\` / \`b.inv[args.v3]\`
Report:
- The exact source line echoed in the traceback and the exact caret/tilde marker line beneath it (count the leading spaces precisely — reproduce with \`cat -A\`).
- The exact internal bidict frame lines (\`File "bidict/_bidict.py", line 80, in __setitem__\` etc.) for each distinct failure mode. Note these differ between ValueDuplicationError (\`_dedup\` line 347?) and KeyAndValueDuplicationError (\`_dedup\` line 333?) — confirm the exact line numbers per mode.
- The \`[PYI-NNN:ERROR] Failed to execute script 'test8' due to unhandled exception!\` trailer: is NNN stable across runs for the same input? Does it vary with input? Run the same case 5 times and different cases, and report what NNN correlates with (it is likely the PID). This matters: the porter may not be able to reproduce it deterministically — say clearly what it depends on.
- Confirm whether stdout produced BEFORE the exception is still flushed, and in what order relative to stderr when both go to a terminal vs a pipe.
- Whether there is anything else on stderr (warnings, etc.).`,
  },
  {
    key: 'string-args',
    prompt: `Dimension: **\`type=str\` key argument handling and stdout encoding**.
Probe:
- Keys that are empty strings, whitespace-only, very long (1000 chars), containing NUL if passable, containing shell-special and unicode chars.
- Whether the key is passed through unchanged (no strip, no normalization). Prove with leading/trailing spaces and a Unicode NFD vs NFC pair (e.g. \`é\` as U+00E9 vs \`e\` + U+0301) — are they treated as DIFFERENT keys? Test by making k1 NFC and k2 NFD with distinct values and see if the bidict has 2 entries.
- stdout encoding: is output UTF-8? Check with \`od -c\` on a non-ASCII key. Any BOM? Any locale-dependent behavior (try running with LC_ALL=C / PYTHONIOENCODING unset vs set) — report whether the porter needs to care.
- Line endings: \`\\n\` only, never \`\\r\\n\`. Confirm with \`od -c\`. Confirm the final line HAS a trailing newline.
- Keys that look like numbers (\`--k1 5\`): key stays the STRING '5' — confirm the repr shows \`'5': ...\` with quotes, and that string '5' and int 5 never collide.
- A key equal to the string \`999\`.
- Does \`b.inv[v]\` ever print something that isn't a plain string?`,
  },
]

phase('Probe')
const probes = await parallel(DIMENSIONS.map(d => () =>
  agent(`${COMMON}\n\n---\n\n${d.prompt}`, { label: `probe:${d.key}`, phase: 'Probe', schema: SPEC_SCHEMA, effort: 'high' })
))

const good = probes.filter(Boolean)
log(`${good.length}/${DIMENSIONS.length} probe dimensions returned`)

phase('Critic')
const digest = good.map(p => `### ${p.dimension}\n${p.implementationNotes}\n\nCases:\n${p.findings.map(f => `- \`${f.case}\` -> rc=${f.rc} | stdout=${JSON.stringify(f.stdout)} | stderr=${JSON.stringify(f.stderr)} | ${f.rule}`).join('\n')}`).join('\n\n')

const critic = await agent(`${COMMON}

Below is the accumulated behavioral spec gathered by six parallel probe agents. Your job: find what is MISSING or WRONG.

${digest}

Act as a completeness critic for a Python->Node.js port. Identify:
1. Any behavior a porter would need that no probe pinned down.
2. Any claim above that looks like a guess rather than an observed byte-exact capture — verify it yourself by running the executable.
3. Any internal contradiction between probes — resolve it by running the executable.
Run whatever commands you need. Return a list of concrete gaps, each with the exact command to run to close it.`,
  { label: 'critic:completeness', phase: 'Critic', effort: 'high', schema: {
    type: 'object',
    properties: {
      gaps: { type: 'array', items: { type: 'object', properties: {
        gap: { type: 'string' }, why: { type: 'string' }, command: { type: 'string' },
      }, required: ['gap', 'why', 'command'] } },
      contradictionsResolved: { type: 'array', items: { type: 'string' } },
      verifiedCorrections: { type: 'array', items: { type: 'string' } },
    },
    required: ['gaps', 'contradictionsResolved', 'verifiedCorrections'],
  } })

phase('Gap')
const gapResults = critic && critic.gaps && critic.gaps.length
  ? await parallel(critic.gaps.slice(0, 12).map((g, i) => () =>
      agent(`${COMMON}\n\n---\n\nClose this specific gap in the port spec by RUNNING the executable. Report byte-exact observations.\n\nGap: ${g.gap}\nWhy it matters: ${g.why}\nSuggested command: ${g.command}\n\nGo beyond the suggested command if needed to fully pin the rule.`,
        { label: `gap:${i}`, phase: 'Gap', schema: SPEC_SCHEMA, effort: 'high' })
    ))
  : []

return {
  probes: good,
  critic,
  gapResults: gapResults.filter(Boolean),
}
