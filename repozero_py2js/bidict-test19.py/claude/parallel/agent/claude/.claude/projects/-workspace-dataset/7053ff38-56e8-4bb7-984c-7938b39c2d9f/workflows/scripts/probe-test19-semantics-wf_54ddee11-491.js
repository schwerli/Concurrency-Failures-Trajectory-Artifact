export const meta = {
  name: 'probe-test19-semantics',
  description: 'Exhaustively probe /workspace/dataset/test19_executable to pin down argparse, int(), str-repr, bidict and buffering semantics',
  phases: [
    { title: 'Probe', detail: 'parallel probers, one per semantic dimension' },
    { title: 'Critic', detail: 'completeness critic finds unprobed behaviors' },
    { title: 'Probe2', detail: 'follow-up probes for gaps the critic found' },
  ],
}

const EXE = '/workspace/dataset/test19_executable'

const COMMON = `
You are probing a PyInstaller-frozen Python program to reverse-engineer its exact observable behavior.
Run it ONLY as: ${EXE} <args>    (never use \`python\`; it is not available)
The program's source is:

    import argparse
    from bidict import bidict
    parser = argparse.ArgumentParser()
    parser.add_argument('--k1', type=str, required=True)
    parser.add_argument('--v1', type=int, required=True)
    parser.add_argument('--k2', type=str, required=True)
    parser.add_argument('--v2', type=int, required=True)
    args = parser.parse_args()
    b1 = bidict({args.k1: args.v1, args.k2: args.v2})
    b2 = b1.copy()
    print(b2)
    b1['new'] = 999
    print(b1)
    print(b2)
    result = b2.inv[args.v1]
    print(result)

Goal: a Node.js reimplementation must match stdout, stderr and exit code character-for-character.
Use bash. Capture stdout and stderr SEPARATELY when it matters, e.g.:
  ${EXE} --k1 a --v1 1 --k2 b --v2 2 >/tmp/o.txt 2>/tmp/e.txt; echo "RC=$?"; then inspect with od -c or cat -A.
Run MANY probes (30+). Be systematic and adversarial: hunt for cases where a naive JS port would differ.
Report ONLY hard empirical findings you actually observed, each with the exact command and the exact bytes of output.
Do not speculate about Python internals you did not observe.
`

const SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          probe: { type: 'string', description: 'exact args passed' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'integer' },
          rule: { type: 'string', description: 'the general rule this probe establishes' },
          jsPortRisk: { type: 'string', description: 'how a naive JS port would get this wrong' },
        },
        required: ['probe', 'rule'],
      },
    },
    rulesSummary: { type: 'string', description: 'Complete, implementable spec for this dimension, written for someone porting to JS' },
  },
  required: ['dimension', 'findings', 'rulesSummary'],
}

const DIMENSIONS = [
  {
    key: 'argparse-parsing',
    prompt: `${COMMON}
YOUR DIMENSION: argparse option-parsing mechanics (exclude int-conversion details, another agent owns that).
Probe at least: --opt value vs --opt=value; option abbreviation/prefix matching (--k, --v, --k1, --he, --hel, --h); the "--" separator; repeated options (last wins?); missing required options (exact error text AND the exact order option names are listed in the error); unrecognized options and unrecognized bare positionals (exact text, and what happens with several); an option consuming a following token that itself looks like an option (--k1 --v1); values that look like negative numbers (--k1 -3, --v1 -3, --k2 -x, --k1 -- , --v1=-3); empty string values; -h / --help alone and mixed with other args and AFTER an invalid arg; what exit code each failure path uses; whether usage goes to stdout or stderr for -h vs for errors; exact trailing newlines of the help text and error text (use od -c).
Also probe: interspersed order of options, an option given a value that starts with "--" via = form, "--k1=" (empty via equals), duplicated "--" , and a lone "-".`,
  },
  {
    key: 'int-conversion',
    prompt: `${COMMON}
YOUR DIMENSION: exactly which strings argparse's type=int accepts for --v1/--v2, and the exact error message when it rejects.
Probe at least: plain digits; leading zeros (007); explicit sign (+5, -5); underscores (1_000, 1_0_0, _1, 1_, 1__0); surrounding ASCII whitespace (" 7 ", tab, newline, \\r, \\f, \\v via $'...' bash quoting); unicode whitespace (U+00A0, U+3000) around digits; empty string; "1.0"; "1e3"; "0x10"; "0b11"; "0o7"; "inf"; "nan"; "True"; a huge 40-digit integer (check the exact digits echoed back in the bidict repr — precision matters); a huge negative integer; unicode decimal digits like Arabic-Indic ٧ (U+0667), Devanagari ७ (U+096F), fullwidth ７ (U+FF17); superscript ² (U+00B2); Roman numeral Ⅶ (U+2167); and a value with an interior space ("1 2").
For each rejection record the EXACT stderr line including how the offending value is quoted/repr'd (try values containing a single quote, e.g. --v1 "it's").
For huge integers verify the printed digits are exact (no float rounding) — this is the top JS-port risk.`,
  },
  {
    key: 'python-str-repr',
    prompt: `${COMMON}
YOUR DIMENSION: how string keys are rendered inside the bidict repr — i.e. Python's str repr / quoting / escaping rules. Only --k1/--k2 are strings.
Probe at least: plain ASCII; string containing only a single quote; only a double quote; BOTH a single and a double quote (which quote char wins, and what gets backslash-escaped?); backslash; newline, tab, carriage return (\\r); \\x00 through \\x1f control chars (via bash $'\\x01' etc.); \\x7f DEL; \\x80-\\x9f C1 controls (via $'\\u0085' etc.); non-breaking space U+00A0; soft hyphen U+00AD; zero-width space U+200B; line separator U+2028; accented letters (é); CJK (中文); emoji incl. one outside the BMP (U+1F600) and a flag/ZWJ sequence; combining marks; U+FFFD; a lone high surrogate if the shell can pass one.
For each, record the EXACT bytes of the repr line (use od -c or cat -A on captured stdout) so escape forms (\\xNN vs \\uNNNN vs \\UNNNNNNNN vs literal char) are unambiguous.
Also: the 4th printed line is print(result) which prints the RAW string (not repr) — confirm raw vs repr difference for a control-char key.
Deliver a precise, implementable rule for: quote selection, which characters are backslash-escaped, and which are escaped as \\xNN / \\uNNNN / \\UNNNNNNNN vs printed literally.`,
  },
  {
    key: 'bidict-semantics',
    prompt: `${COMMON}
YOUR DIMENSION: the bidict container semantics and every error path, including exit codes and what has already been printed to stdout before the error.
Probe at least: distinct keys+distinct values (happy path); k1==k2 with different values (which value survives? what insertion POSITION does the surviving entry occupy? does bidict raise?); k1==k2 with equal values; v1==v2 with different keys (exact exception class+message); v1==v2 AND k1==k2; v1==999 (collides with the b1['new']=999 line) — exact exception, and exactly which stdout lines were printed before it; v2==999; k1=='new'; k2=='new'; k1=='new' AND v1==999; k2=='new' AND v2==999; k1=='new' with v2==999; the b2.inv[v1] KeyError case (reachable when k1==k2 so v1 was dropped) — exact message incl. how the key is repr'd; negative and huge values.
For every failing probe record: exact stdout bytes, exact stderr bytes, exit code.
Also determine: does b2 (the copy) ever change after b1 is mutated? Is the insertion ORDER of b1 after b1['new']=999 append-at-end, or in-place when 'new' already exists? Prove it.
Deliver a full decision table: given (k1,v1,k2,v2) which of the 4 lines print and which exception (if any) fires.`,
  },
  {
    key: 'output-buffering-and-streams',
    prompt: `${COMMON}
YOUR DIMENSION: stream/buffering/exit-code mechanics, which a JS port must mimic.
Probe: which stream each of the 4 print lines goes to; which stream tracebacks go to; whether the traceback appears BEFORE or AFTER the stdout lines when stdout and stderr are merged into ONE pipe (2>&1 | cat) vs when redirected to separate files vs when attached to a terminal (try \`script -qec\` or a pty if available) — this reveals Python's buffering mode. Use a failing probe such as: --k1 a --v1 999 --k2 b --v2 2 (fails at b1['new']=999 after one line was printed).
Record the exact full traceback text for each distinct failure mode, byte for byte, and note any part of it that is NON-DETERMINISTIC across runs (run the same failing probe 5+ times and diff). Report exactly which bytes vary.
Also: exact trailing newline behavior of the last stdout line; exit codes for success / uncaught exception / argparse error; behavior when stdout is closed early (e.g. \`| head -1\`).`,
  },
]

phase('Probe')
const probes = await parallel(DIMENSIONS.map(d => () =>
  agent(d.prompt, { label: `probe:${d.key}`, phase: 'Probe', schema: SCHEMA })
))
const good = probes.filter(Boolean)
log(`${good.length}/${DIMENSIONS.length} dimensions probed`)

phase('Critic')
const digest = good.map(p => `### ${p.dimension}\n${p.rulesSummary}`).join('\n\n')
const critique = await agent(`${COMMON}

Five probing agents produced this combined spec of the program's behavior:

${digest}

You are the COMPLETENESS CRITIC. Your job is to find what is MISSING or WRONG.
1. Identify behaviors a Node.js port must match that are NOT pinned down above, or where the spec is vague/ambiguous/self-contradictory.
2. Actively try to FALSIFY at least 8 specific claims above by running the executable yourself. Report any claim that is wrong.
Focus on the highest-risk gaps for a JS port: BigInt precision, Python str-repr escaping of astral/surrogate/C1 characters, argparse abbreviation and negative-number handling, error-message wording and option ORDER, insertion-order semantics, exit codes.
Return a list of concrete OPEN QUESTIONS, each phrased as a specific probe command to run, plus any falsified claims with evidence.`,
  { phase: 'Critic', schema: {
    type: 'object',
    properties: {
      falsifiedClaims: { type: 'array', items: { type: 'object', properties: { claim: {type:'string'}, evidence: {type:'string'} }, required: ['claim','evidence'] } },
      openQuestions: { type: 'array', items: { type: 'string' } },
    },
    required: ['falsifiedClaims', 'openQuestions'],
  }})

phase('Probe2')
const gaps = (critique?.openQuestions || []).slice(0, 12)
const followups = gaps.length ? await parallel(gaps.map((q, i) => () =>
  agent(`${COMMON}

Resolve this ONE open question empirically by running the executable. Be exhaustive on this narrow point.

OPEN QUESTION: ${q}

Return the definitive answer with exact commands and exact output bytes (use od -c where escapes matter), plus the implementable rule for a JS port.`,
    { label: `gap:${i + 1}`, phase: 'Probe2', schema: {
      type: 'object',
      properties: { question: {type:'string'}, answer: {type:'string'}, evidence: {type:'string'}, jsRule: {type:'string'} },
      required: ['question','answer','jsRule'],
    }})
)) : []

return {
  dimensions: good,
  critique,
  followups: followups.filter(Boolean),
}
