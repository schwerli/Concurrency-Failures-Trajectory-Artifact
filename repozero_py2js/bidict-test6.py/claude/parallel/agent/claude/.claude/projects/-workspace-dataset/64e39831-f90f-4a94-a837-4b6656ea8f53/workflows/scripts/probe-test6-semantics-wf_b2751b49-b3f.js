export const meta = {
  name: 'probe-test6-semantics',
  description: 'Differentially probe /workspace/dataset/test6_executable to extract an exact behavioral spec for a Node.js port',
  phases: [
    { title: 'Probe', detail: 'parallel agents probe distinct behavioral dimensions of the executable' },
    { title: 'Critique', detail: 'completeness critic finds unprobed dimensions' },
    { title: 'Probe2', detail: 'follow-up probes for gaps the critic found' },
  ],
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'findings', 'jsImplementationNotes'],
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'stdout', 'stderr', 'exitCode', 'rule'],
        properties: {
          argv: { type: 'array', items: { type: 'string' }, description: 'exact argv passed after the program name, with escapes spelled out' },
          stdout: { type: 'string', description: 'exact stdout with \\n shown literally' },
          stderr: { type: 'string', description: 'exact stderr with \\n shown literally' },
          exitCode: { type: 'integer' },
          rule: { type: 'string', description: 'the general rule this case demonstrates' },
        },
      },
    },
    jsImplementationNotes: {
      type: 'array',
      items: { type: 'string' },
      description: 'concrete, actionable notes for reimplementing this dimension in pure Node.js 18 with zero deps',
    },
    surprises: { type: 'array', items: { type: 'string' } },
  },
}

const EXE = '/workspace/dataset/test6_executable'

const PREAMBLE = `You are reverse-engineering a frozen Python CLI so it can be reimplemented exactly in Node.js 18 (pure JS, zero npm deps, ESM).

The Python source is:
\`\`\`python
import argparse
from bidict import bidict
parser = argparse.ArgumentParser()
parser.add_argument('--key', type=str, required=True)
parser.add_argument('--val', type=int, required=True)
args = parser.parse_args()
b = bidict({'a': 1, 'b': 2, 'c': 3})
result1 = args.key in b
result2 = args.val in b.inv
print(result1)
print(result2)
\`\`\`

Probe the compiled executable at ${EXE}. Run it directly (NEVER use the \`python\` command; python is not available).
Capture stdout, stderr and exit code SEPARATELY, e.g.:
  ${EXE} --key a --val 3 >/tmp/o.txt 2>/tmp/e.txt; echo "rc=$?"; od -c /tmp/o.txt; od -c /tmp/e.txt
Use \`od -c\` or \`xxd\` whenever exact bytes/newlines matter. Use bash $'...' quoting for control chars and printf/python-free tricks for unicode.
You may write scratch files under /tmp. Do NOT write anything to /output or /workspace.
Run MANY cases (30+). Be systematic and adversarial: hunt for cases where a naive JS port would diverge.

YOUR DIMENSION: `

const DIMENSIONS = [
  {
    key: 'argparse-structure',
    prompt: `Optional-argument parsing structure. Cover: long-option abbreviation (--k, --ke, --v, --va, --h, --he) and any ambiguity errors; --opt=value syntax including --val= (empty) and --key=; repeated options (last wins?); option value that itself looks like an option (--key --val, --val --key); values starting with a single dash that are negative numbers (--key -5, --val -5, --key -5.5, --key -x); the '--' pseudo-argument in every position (leading, trailing, middle, doubled); extra positionals; unknown options (-k, --keyx, --nope) and whether the "required" error pre-empts the "unrecognized arguments" error; missing one/both required options; interaction of -h/--help with missing required options and with invalid values (does help win?); empty-string option name/value; duplicated '--key=x --key y'. Report the exact stderr text and exit code for each error class.`,
  },
  {
    key: 'int-conversion',
    prompt: `The exact accept/reject behaviour of Python's int() as used by type=int, since a naive JS Number()/parseInt() port will diverge. Cover: surrounding whitespace of EVERY kind Python strips (space, \\t, \\n, \\r, \\v, \\f, \\x1c, \\x1d, \\x1e, \\x1f, \\x85, \\xa0/NBSP, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000) — for each, does it strip or is it "invalid int value"?; internal whitespace; signs (+7, -7, ++7, +-7, sign with space '- 7'); underscores (1_0, 1__0, _10, 10_, 1_0_0, +1_0, '1_ 0'); leading zeros (007, 0_0_7); base prefixes (0x3, 0b11, 0o3); floats/exponents (1.0, 1e3, 3.); empty and whitespace-only; huge integers (20+ digits, and 10**30) and confirm exit code 0; -0; non-ASCII DECIMAL digits from several scripts (Arabic-Indic U+0663, Extended Arabic-Indic U+06F3, Devanagari U+0969, Bengali, Thai, fullwidth U+FF12/U+FF13, Mathematical Bold Digit U+1D7CE-block e.g. U+1D7D1, Osmanya/other SMP digits) — do they convert, and do MIXED scripts work (e.g. Arabic-Indic 3 next to ASCII 4, or two different scripts)?; non-Nd numerics that must FAIL (superscript ² U+00B2, Roman numeral Ⅲ U+2162, circled ③ U+2462, fraction ½, Chinese 三); a non-Nd char combined with digits. Also: how is the offending value rendered in the error message (quoting style) for values containing a single quote, a double quote, a backslash, a newline, a NUL-adjacent control char, or non-ASCII? Give the exact stderr bytes for those.`,
  },
  {
    key: 'membership-and-output',
    prompt: `Membership semantics and output bytes. Cover: which --key values print True (exactly 'a','b','c'? case sensitivity 'A'; whitespace-padded ' a'; unicode lookalikes; multi-char 'ab'; empty string; the string '1'); which --val values print True (1,2,3 and their equivalent spellings via int() such as '+1', '01', '1_0'->10, unicode digit forms of 1/2/3, ' 3 ') and which print False (0,4,-1,huge); confirm the two output lines are exactly 'True'/'False' and that stdout ends with a trailing newline and uses \\n not \\r\\n (prove with od -c); confirm help text goes to stdout and errors go to stderr (prove by redirecting each stream separately); confirm the ordering/interleaving of the two printed lines; confirm behaviour when stdout is a pipe vs a file (any buffering-visible difference in byte content). Also verify whether --key can be a value that equals an int-like string and still only matches string keys.`,
  },
  {
    key: 'help-usage-bytes',
    prompt: `Exact byte-for-byte reproduction of every message the program can emit. Produce the FULL exact text (with od -c proof) of: (1) --help / -h output including blank lines, the header word used ('options:' vs 'optional arguments:'), two-space/indent widths, column alignment and trailing newline; (2) the usage line as it appears on the error path; (3) each distinct error message: both-required, one-required (both orderings, and check the ORDER the missing options are listed in), invalid int value, expected one argument, unrecognized arguments (single and multiple extras), ambiguous option if reachable, unknown-option-with-suggestion if any. State the program name string used in these messages and where argparse derives it from. Note the exact exit codes. Also check whether COLUMNS/terminal width env var changes wrapping (try COLUMNS=20 and COLUMNS=200) since a JS port must decide whether to wrap.`,
  },
  {
    key: 'bidict-library-behaviour',
    prompt: `The behaviour of the bidict library itself, inferred as a black box, so the JS port's bidict module is faithful even beyond what this script exercises. You cannot read bidict's source and cannot run python. So: reason ONLY from the public documented interface and from what this executable proves, then WebSearch/WebFetch the bidict public docs (readthedocs/PyPI/GitHub README) to confirm the public API contract: constructor from a dict, __contains__ on keys, .inv / .inverse property and its aliasing (b.inv.inv is b), forcing/put/forceput/putall semantics, ValueDuplicationError / KeyDuplicationError / KeyAndValueDuplicationError / DuplicationError hierarchy and when each is raised (__init__ with duplicate values? __setitem__ over an existing value?), OrderedBidict vs bidict ordering guarantees, iteration order, len, equality with plain dicts, and what happens on del. Return a precise API contract list for the JS reimplementation. Note explicitly which parts are documented fact vs your inference. Do not run the executable more than a few times; this dimension is mostly documentation research.`,
  },
  {
    key: 'process-and-encoding',
    prompt: `Process-level and encoding behaviour. Cover: argv containing invalid UTF-8 bytes (e.g. $'\\xff') for --key and for --val — does it crash, and what exactly is printed?; argv containing a NUL-adjacent control byte; very long argv values (10k chars); --key with an emoji / astral-plane char / combining sequence (does 'e\\u0301' differ from 'é'?); locale env effects (LC_ALL=C, LANG=C, PYTHONIOENCODING=ascii) on output bytes and on non-ASCII error messages; behaviour with no TTY (piped stdin/stdout) vs TTY; whether stdin is read at all; exit code when stdout is closed (e.g. | head -0) — does it emit a BrokenPipe traceback?; whether any output is produced before an error (i.e. is stdout empty on the rc=2 paths?); PYTHONHASHSEED variation affecting anything observable. For each, say what a Node.js port must do to match, and where matching is impossible/irrelevant.`,
  },
]

phase('Probe')
const probes = await parallel(DIMENSIONS.map((d) => () =>
  agent(PREAMBLE + d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: SPEC_SCHEMA })
))

const good = probes.filter(Boolean)
log(`collected ${good.length}/${DIMENSIONS.length} dimension specs`)

phase('Critique')
const digest = good.map((p) => `## ${p.dimension}\nRULES:\n${p.findings.map((f) => `- argv=${JSON.stringify(f.argv)} -> out=${JSON.stringify(f.stdout)} err=${JSON.stringify(f.stderr)} rc=${f.exitCode} :: ${f.rule}`).join('\n')}\nNOTES:\n${p.jsImplementationNotes.map((n) => `- ${n}`).join('\n')}\nSURPRISES:\n${(p.surprises || []).map((s) => `- ${s}`).join('\n')}`).join('\n\n')

const GAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'whyItMatters', 'concreteProbe'],
        properties: {
          question: { type: 'string' },
          whyItMatters: { type: 'string' },
          concreteProbe: { type: 'string', description: 'exact shell command(s) to run against the executable to answer it' },
        },
      },
      maxItems: 12,
    },
  },
}

const critique = await agent(
  `${PREAMBLE}COMPLETENESS CRITIC. Below is the accumulated behavioural spec extracted by six probe agents for ${EXE}.

${digest}

Your job: find what is still UNKNOWN or UNVERIFIED that could make a Node.js port diverge observably. Focus on things a careful reimplementer would get wrong: claims asserted without a run, argv shapes nobody tried, interactions BETWEEN dimensions (e.g. help + invalid int, unicode digit + underscore, abbreviation + '=' + negative number), and any rule stated only as inference. Do not repeat cases already covered above. Output at most 12 high-value gaps, each with an exact probe command. Run a couple yourself first to make sure the gap is real (not already answered).`,
  { label: 'critic:gaps', phase: 'Critique', schema: GAP_SCHEMA, effort: 'high' }
)

phase('Probe2')
const gaps = (critique && critique.gaps) || []
log(`critic raised ${gaps.length} gaps`)

const followups = await parallel(gaps.map((g, i) => () =>
  agent(
    `${PREAMBLE}GAP-CLOSING PROBE #${i + 1}. Answer this open question about ${EXE} by actually running it (capture stdout/stderr/rc separately, od -c where bytes matter).

QUESTION: ${g.question}
WHY IT MATTERS: ${g.whyItMatters}
SUGGESTED PROBE: ${g.concreteProbe}

Run the suggested probe plus any variations needed to state a precise, general rule. Report the definitive answer and the exact JS implementation requirement it implies.`,
    { label: `gap${i + 1}`, phase: 'Probe2', schema: SPEC_SCHEMA }
  )
))

return {
  dimensions: good,
  gaps,
  gapAnswers: followups.filter(Boolean),
}
