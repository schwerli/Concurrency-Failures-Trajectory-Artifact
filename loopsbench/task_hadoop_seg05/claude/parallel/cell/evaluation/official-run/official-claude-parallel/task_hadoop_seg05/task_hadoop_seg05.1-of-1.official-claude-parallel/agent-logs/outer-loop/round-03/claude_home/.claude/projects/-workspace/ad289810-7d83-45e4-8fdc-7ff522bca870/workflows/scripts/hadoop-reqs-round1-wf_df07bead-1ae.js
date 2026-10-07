export const meta = {
  name: 'hadoop-reqs-round1',
  description: 'Implement Hadoop requirement batch 1 across file-disjoint lanes',
  phases: [{ title: 'Implement', detail: '16 parallel lanes, sequential within lane' }],
}

const LANES = [
  ['native-tools', ['cross-platform-dirent', 'hdfs-df-cross-platform', 'hdfs-du-cross-platform', 'deletesnapshot-cross-platform', 'snapshot-tools-cross-platform']],
  ['native-win', ['windows-ssize-t', 'windows-cmake-args', 'windows-libhdfspp-static', 'libhdfspp-windows-libcrypto', 'libhdfspp-openssl-discovery']],
  ['s3a-audit', ['s3a-auditing-default-off', 's3a-audit-threadlocal-leak', 'auditmanagerdisabled-test-defaults', 's3autils-limitedprivate-methods', 's3a-buffer-yarn-path']],
  ['s3a-core', ['s3a-delete-on-exit', 's3a-requester-pays-support', 's3a-syncable-downgrade', 'sts-client-shutdown', 'rename-bulk-delete-batching']],
  ['abfs', ['abfs-global-test-timeout', 'abfs-listfiles-test-failure', 'abfs-rename-recovery-removal', 'abfs-rename-metadata-recovery']],
  ['dn-slowpeer', ['slow-datanode-metrics', 'slow-datanode-metrics-docs', 'slow-peer-outlier-metrics', 'slow-node-latency-reporting', 'slow-peer-jmx-reconfig']],
  ['nn-reconfig', ['blockreport-interval-reconfigurable', 'block-invalidate-limit-reconfigure', 'slowpeer-collect-nodes-reconfigurable', 'slow-datanode-reconfigurable', 'namenode-slow-peer-reconfigure']],
  ['hdfs-ec', ['ec-safe-length-overflow', 'ec-group-block-limit', 'ec-decoding-concurrent-preads', 'ec-decoding-valid-inputs', 'ec-reconstruction-source-check']],
  ['hdfs-balancer', ['striped-block-balancer-npe', 'balancer-ec-block-transfer', 'balancer-stale-storage-blocks', 'balancer-standby-namenode-logging', 'balanced-space-placement']],
  ['rbf-fairness', ['accepted-permits-nameservice', 'rejected-permits-nameservice', 'rbf-available-handler-metrics', 'router-fairness-handler-validation', 'rbf-fairness-policy-reconfigure']],
  ['rbf-rpc', ['rbf-available-ns-retry', 'rbf-invokeatavailablens-retry', 'routerid-without-routerrpc', 'rbfmetrics-prometheussink-registration', 'subcluster-router-metrics']],
  ['yarn-fed-client', ['federation-signaltocontainer-support', 'federation-client-api-support', 'federation-getclusternodes-api', 'federation-queue-api-support']],
  ['yarn-router-rest', ['router-node-to-labels', 'router-node-label-rest', 'router-app-timeout-rest', 'router-app-attempt-rest', 'router-container-rest']],
  ['yarn-cs', ['capacityscheduler-init-cleanup', 'capacityscheduler-async-state-class', 'abstractcsqueue-field-grouping', 'queue-limit-recompute', 'auto-queue-depth-config']],
  ['build-pom', ['jackson-version-bump', 'jackson-2-13-0', 'maven-enforcer-dependencies', 'maven-rules-static-imports', 'maven-test-failure-ignore']],
  ['common-misc', ['callercontext-character-filtering', 'configuration-substitutevars-wrapper', 'io-file-buffer-size', 'close-socketchannel-on-ioexception', 'retry-count-logging']],
]

function promptFor(slug) {
  return `You are implementing ONE requirement in the Apache Hadoop repository at /workspace.

The repo is a real Apache Hadoop source tree checked out at an earlier state (roughly Hadoop 3.4 development, late 2021 / 2022). Each requirement corresponds to a real upstream JIRA/PR that must be re-implemented.

## Your requirement
Read the file \`/workspace/requirements/${slug}.yaml\`. It contains a title (usually with the JIRA id) and a prose requirement description. Implement it faithfully in the source tree.

## How to work
1. Read the requirement YAML first.
2. Use the JIRA id in the title plus the description to figure out exactly what upstream change is being asked for. Search the repo for the relevant classes/files (Grep/Glob/Read).
3. Make the change the way the surrounding Hadoop code is written: same style, same logging idioms (SLF4J placeholders), same javadoc conventions, Apache license headers on new files, 2-space indent, 80-col-ish lines, no tabs.
4. Prefer a complete, faithful implementation over a token change. If the requirement mentions new config keys, add them to the matching \`*-default.xml\` and the \`*Keys\`/\`*ConfigKeys\` class. If it mentions docs, update the markdown under \`src/site/markdown\`. If it mentions metrics, wire them through the metrics classes properly.
5. You may add or update unit tests in the normal Hadoop test source trees when the requirement implies test coverage.
6. Do NOT run \`mvn\` builds (far too slow). Instead re-read your edits carefully to be sure they compile: check imports, types, method signatures, and that every symbol you reference actually exists in this tree.

## Hard constraints — other agents are editing this same working tree in parallel
- NEVER run \`git checkout\`, \`git reset\`, \`git stash\`, \`git clean\`, \`git revert\`, \`git rebase\`, or \`git add -A\` without a pathspec. Those would destroy other agents' concurrent work.
- Only touch files that are genuinely part of YOUR requirement.
- Do not edit \`/workspace/requirements/**\` or other agents' patch files.

## Finishing: commit your requirement (REQUIRED)
When the implementation is done, collect the exact list of file paths you created/modified/deleted (repo-relative, space separated) and run EXACTLY this, substituting your paths:

\`\`\`bash
cd /workspace && flock /tmp/hadoop-git.lock bash -c 'cd /workspace && git add -A -- <PATH1> <PATH2> ... && git diff --cached > requirement_patches/${slug}.diff && git add -- requirement_patches/${slug}.diff && git commit -q -m "impl: ${slug}"'
\`\`\`

Then verify with \`wc -l /workspace/requirement_patches/${slug}.diff\` that the patch is NON-EMPTY, and \`git log --oneline -1\` shows your commit. If the patch came out empty, your change did not land — investigate and redo it. An empty patch means the requirement FAILS.

## Return value
Return a short plain-text report: the slug, whether the commit succeeded, the patch line count, and 1-3 sentences on what you changed. Do not paste diffs.`
}

phase('Implement')

const results = await parallel(LANES.map(([lane, slugs]) => async () => {
  const out = []
  for (const slug of slugs) {
    const r = await agent(promptFor(slug), { label: `${lane}:${slug}`, phase: 'Implement' })
    out.push(`[${lane}] ${slug}: ${r ? String(r).slice(0, 400) : 'FAILED/null'}`)
    log(`${lane} finished ${slug}`)
  }
  return out.join('\n')
}))

return results.filter(Boolean).join('\n')
