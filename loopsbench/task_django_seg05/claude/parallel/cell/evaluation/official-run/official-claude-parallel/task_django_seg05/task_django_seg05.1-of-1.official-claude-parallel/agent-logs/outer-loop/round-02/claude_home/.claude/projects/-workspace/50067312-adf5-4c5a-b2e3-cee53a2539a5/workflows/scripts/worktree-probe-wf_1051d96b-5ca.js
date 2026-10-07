export const meta = {
  name: 'worktree-probe',
  description: 'Probe whether worktree isolation works in this repo',
  phases: [{ title: 'Probe', detail: 'one agent checks its cwd and git state' }],
}
phase('Probe')
const r = await agent(
  `Run these shell commands and report the raw output verbatim:\n` +
  `1. pwd\n2. git rev-parse --show-toplevel\n3. git rev-parse --abbrev-ref HEAD\n4. git status --short | head\n` +
  `Then create a file named PROBE.txt containing the text "probe" at the repo root of your current working directory, ` +
  `then run: git add -A && git diff --cached --stat\n` +
  `Then write the patch: git add -A && git diff --cached --binary > /tmp/wfp/__probe.patch ; then run: wc -c /tmp/wfp/__probe.patch\n` +
  `Report all outputs.`,
  { label: 'probe', isolation: 'worktree' }
)
log('probe done')
return r