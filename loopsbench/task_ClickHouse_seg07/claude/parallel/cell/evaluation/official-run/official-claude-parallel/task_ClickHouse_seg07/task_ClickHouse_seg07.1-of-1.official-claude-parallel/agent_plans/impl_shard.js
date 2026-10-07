export const meta = {
  name: 'ch-impl-shard',
  description: 'Implement a shard of ClickHouse requirements, one agent per requirement, each self-committing',
  whenToUse: 'Fan out requirement implementation across many subagents',
  phases: [
    { title: 'Implement' },
  ],
}

const input = args || {}
const slugs = Array.isArray(input) ? input : (input.slugs || [])
const serial = !Array.isArray(input) && !!input.serial
const note = (!Array.isArray(input) && input.note) ? `\n## Shard note\n${input.note}\n` : ''

const SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    committed: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['slug', 'committed', 'summary'],
  additionalProperties: false,
}

function prompt(slug) {
  return `You are implementing exactly ONE requirement in the ClickHouse source tree at /workspace.

The repo is a PRUNED snapshot of ClickHouse from roughly the 22.7–22.12 era. Each requirement under
/workspace/requirements/ was distilled from a REAL upstream ClickHouse pull request. Your job is to make
the real source change that satisfies it — faithful to what upstream did, minimal, and stylistically
indistinguishable from the surrounding code.

## Your requirement
slug: ${slug}
file: /workspace/requirements/${slug}.yaml
${note}
## Procedure
1. Read /workspace/requirements/${slug}.yaml in full. "Desired outcome" and "Acceptance signals" are the
   contract. Read /workspace/agent_plans/SNAPSHOT_NOTES.md — it tells you what exists in this snapshot,
   what was pruned, the canonical upstream paths to create, and the recipes for common requirement
   families. Do that BEFORE searching, it saves a lot of flailing.
2. Locate the exact code. Grep aggressively for identifiers, error strings, setting names, function
   names, and log messages quoted in the requirement. Read enough surrounding code to be certain. If the
   requirement names a symbol, find its definition AND its call sites.
3. Implement the change.
   - Match surrounding style exactly (ClickHouse uses 4-space indent, Allman braces, snake_case locals,
     CamelCase types, \`/// \` doc comments).
   - Be minimal and surgical: no drive-by reformatting, no unrelated renames, no speculative extras.
   - Prefer editing the file(s) the requirement points at over inventing new ones.
   - New setting → src/Core/Settings.h in the right section (+ SettingsEnums if it's an enum,
     + SettingsChangesHistory.h when the requirement is about compatibility).
   - New system-table column → the *Log.h/.cpp pair AND every site that fills the struct.
   - Error message / wording / typo fix → fix EVERY occurrence of the same wrong text in the repo.
   - Revert requirements → actually remove/undo the feature's code, settings, and docs.
   - A behavioral bugfix normally deserves a stateless test too (see SNAPSHOT_NOTES for paths) — add one
     when the requirement's acceptance signal is a concrete query result.
4. Do NOT try to compile or run ClickHouse — there is no toolchain and a build would take hours. Instead
   re-read your edit for syntax/type correctness: headers included, names exist, signatures match,
   braces balanced.
5. Commit ONLY your own files:
     /workspace/.agent_commit.sh ${slug} <repo-relative-path> [<path> ...]
   e.g.  /workspace/.agent_commit.sh ${slug} src/Functions/foo.cpp src/Core/Settings.h
   It is flock-serialized and refuses an empty diff.

## Hard rules — read these twice
- FIRST run \`cd /workspace && git status --short\`. An earlier interrupted run may have left UNCOMMITTED
  partial work. If some of it is clearly part of YOUR requirement, inspect it with
  \`git diff -- <path>\` and FINISH it (make it compile-coherent: every removed symbol's users updated,
  every declared member actually used) instead of starting over or reverting it.
- You MUST end with a successful .agent_commit.sh run (it prints "OK committed"). Never finish without it.
- If the exact upstream change is genuinely unlocatable, do NOT give up and do NOT commit a no-op: pick
  the most faithful concrete interpretation the snapshot supports (the doc page, the test, the wording
  fix, the setting, the log-level change) and make that real change. Every requirement must end in a
  coherent, reviewable diff.
- If it reports an EMPTY DIFF: a concurrent agent may have swept your file into its commit. Run
  \`git log --oneline -3\` and \`git show --stat HEAD\` to check. Then make an additional genuine change
  in your own requirement's scope (the matching test, the doc section, another occurrence of the fix) and
  commit again listing that path. Do not give up.
- NEVER run git add / git commit / git checkout / git reset / git stash / git restore / git clean. Only
  the helper script. Never touch .git directly. Never revert or delete work you did not make.
- Other agents are editing OTHER files in this same working tree RIGHT NOW. Touch only files in your
  requirement's scope. On existing files use the Edit tool (targeted string replacement), never Write —
  Write can clobber a concurrent agent's edits. If an Edit fails because the string moved, re-Read the
  file and retry.
- Do not edit /workspace/requirements/**, /workspace/requirement_patches/**, /workspace/agent_plans/**,
  or .agent_commit.sh.

Return JSON: slug, committed (true only if the helper printed OK), files (repo-relative paths you
changed), summary (1-3 sentences on what you changed).`
}

phase('Implement')
log(`implementing ${slugs.length} requirements (${serial ? 'SEQUENTIAL' : 'parallel'})`)

let results = []
if (serial) {
  for (const slug of slugs) {
    const r = await agent(prompt(slug), { label: slug, phase: 'Implement', schema: SCHEMA })
      .catch(() => null)
    results.push(r)
  }
} else {
  results = await pipeline(
    slugs,
    (slug) => agent(prompt(slug), { label: slug, phase: 'Implement', schema: SCHEMA }),
  )
}

const ok = results.filter(r => r && r.committed)
const bad = results.map((r, i) => (r && r.committed) ? null : (r ? r.slug : slugs[i])).filter(Boolean)
log(`committed ${ok.length}/${slugs.length}; failed: ${bad.length}`)
return { committed: ok.map(r => r.slug), failed: bad }
