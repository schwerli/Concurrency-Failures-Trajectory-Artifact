export const meta = {
  name: 'jenkins-reqs-wave1',
  description: 'Implement wave-1 independent Jenkins core requirements in parallel',
  phases: [{ title: 'Implement', detail: 'one agent per requirement, disjoint files' }],
}

const COMMON = `
You are implementing ONE requirement in the Jenkins core repository at /workspace (version 2.452.3-SNAPSHOT).

CRITICAL RULES:
- There is NO maven repository available, so you CANNOT compile or run tests. Your edits must be correct by careful inspection. Read the surrounding code fully before editing.
- Read /workspace/requirements/<SLUG>.yaml first: it contains the change request (title, context, desired outcome, acceptance signals).
- Implement the requirement FAITHFULLY and COMPLETELY, matching how the real upstream Jenkins change would look. Match surrounding code style, imports, javadoc conventions, and licence headers.
- ONLY modify the files listed in "ALLOWED FILES" below (you may create new files listed there). Do NOT touch any other file. Other agents are working on other files concurrently.
- Do NOT run any git command that changes state (no add/commit/checkout/stash). Read-only git (log/show/diff) is fine.
- Do NOT create or edit files under /workspace/requirement_patches or /workspace/agent_plans.
- If a message resource string is needed, add it to the appropriate Messages.properties file (if that file is in your allowed list).

Return a SHORT report: list of files changed/created, and 1-3 sentences per file describing the change. Do not paste large diffs.
`

const REQS = [
  {
    slug: 'idiomatic-python-style',
    files: ['/workspace/update-since-todo.py'],
    hint: `The script /workspace/update-since-todo.py should follow idiomatic Python style: snake_case names everywhere, and CI detection should use os.environ / "CI" env var idiomatically (e.g. os.environ.get("CI")) rather than a non-idiomatic check. Rename any non-snake_case identifiers, use idiomatic constructs, but DO NOT change behaviour. Read the whole file first and look specifically for camelCase names, non-idiomatic environment checks, and non-idiomatic subprocess/string handling.`,
  },
  {
    slug: 'flightrecorder-buffer-size',
    files: ['/workspace/cli/src/main/java/hudson/cli/FlightRecorderInputStream.java'],
    hint: `NOTE the requirement title says "reduce from 1MiB to 1KiB" but the body/acceptance signals ask for a LARGER default capture window that stays configurable via the system property hudson.remoting.FlightRecorderInputStream.BUFFER_SIZE. Follow the BODY: the default buffer size must be substantially larger than the current value (upstream used 1 MiB = 1024*1024) and still read SystemProperties/Integer.getInteger with key "hudson.remoting.FlightRecorderInputStream.BUFFER_SIZE". Ensure the constant is documented and the diagnostic output retains the recent traffic.`,
  },
  {
    slug: 'cli-websocket-handshake-errors',
    files: ['/workspace/cli/src/main/java/hudson/cli/CLI.java'],
    hint: `In the -webSocket connection path, catch the WebSocket handshake failure (jakarta/javax websocket DeploymentException whose cause or self is a Jetty DeploymentHandshakeException / the Jetty UpgradeException) and print a friendly message of the exact form "CLI handshake failed with status code 401" (using the actual status code), followed by the response headers (one per line, e.g. "Server: Jetty"), then exit with status 15. Look at how the class currently reports errors and what exit codes/constants exist. Use the jetty client's org.eclipse.jetty.websocket.client.exception/ DeploymentHandshakeException-style API guarded by instanceof + reflection-free access if the type is available on the CLI classpath; otherwise inspect the exception chain. Keep the existing behaviour for other failures.`,
  },
  {
    slug: 'background-discarder-logging',
    files: ['/workspace/core/src/main/java/jenkins/model/BackgroundGlobalBuildDiscarder.java'],
    hint: `Remove the routine per-job progress logging from the listener inside BackgroundGlobalBuildDiscarder (JENKINS-73692) while keeping the discarder behaviour and any error/warning logging intact.`,
  },
  {
    slug: 'os-eol-warning-date',
    files: ['/workspace/core/src/main/java/jenkins/monitor/OperatingSystemEndOfLifeAdminMonitor.java'],
    hint: `JENKINS-73845: on the very first warning day the monitor must already report the real configured end-of-life date from getEndOfLifeDate(). Read the current isActivated/date-computation logic carefully: the bug is that the endOfLifeDate field is only assigned in a code path that runs after (or not at all on) the first warning day. Restructure so the matched operating-system's configured end-of-life date is assigned whenever the OS pattern matches (and the monitor activates on the first warning day, i.e. use a >= / !isBefore comparison rather than a strictly-after comparison).`,
  },
  {
    slug: 'typedfilter-race-leak',
    files: ['/workspace/core/src/main/java/jenkins/security/stapler/TypedFilter.java'],
    hint: `Replace the mutable static/instance Map cache of class->relevance with a thread-safe, class-scoped, leak-resistant mechanism. Upstream used a org.kohsuke.stapler.ClassDescriptor-free approach: a per-class value cached via a ClassValue<Boolean> (java.lang.ClassValue) so entries are collected with the class loader and lookups are thread-safe. Keep the acceptable/unacceptable decision logic identical.`,
  },
  {
    slug: 'staplerfilteredactionlistener-log-level',
    files: ['/workspace/core/src/main/java/jenkins/security/stapler/StaplerFilteredActionListener.java'],
    hint: `Turn the WARNING-level log messages about blocked/filtered dispatches down to a finer diagnostic level (Level.FINE) while keeping the denial behaviour identical.`,
  },
  {
    slug: 'revert-fileboolean-path-traversal',
    files: ['/workspace/core/src/main/java/jenkins/util/io/FileBoolean.java', '/workspace/src/spotbugs/excludesFilter.xml', '/workspace/core/src/spotbugs/excludesFilter.xml'],
    hint: `Revert the PATH_TRAVERSAL_IN "fix" in FileBoolean: the constructor taking (Class owner, String name) must go back to resolving the file as new File(Jenkins.get().getRootDir(), owner.getName().replace('$','.') + '/' + name) style full owner-derived path under the Jenkins root (read git history / the current code to see exactly what was sanitized away, e.g. a call that stripped the path to only the file name or used a sanitizing helper). Then document the SpotBugs finding as a false positive by adding a PATH_TRAVERSAL_IN exclusion for FileBoolean in the spotbugs excludes filter file that actually exists in this repo (find it first with a search; only edit the one that exists).`,
  },
  {
    slug: 'zip-installer-non-http-urls',
    files: ['/workspace/core/src/main/java/hudson/tools/ZipExtractionInstaller.java'],
    hint: `JENKINS-75003: in the doCheckUrl form validation, when the URI scheme is not http/https, accept the value if Path.of(uri) (java.nio.file.Path) resolves without throwing; only report the existing malformed-URL error when it throws (InvalidPathException / IllegalArgumentException). Keep the HTTP(S) reachability checks unchanged.`,
  },
  {
    slug: 'resource-url-escape-hatch',
    files: ['/workspace/core/src/main/java/jenkins/security/ResourceDomainRootAction.java'],
    hint: `JENKINS-73422: add a static, non-final, SuppressFBWarnings-annotated escape-hatch boolean field ALLOW_AUTHENTICATED_USER (settable via SystemProperties.getBoolean("jenkins.security.ResourceDomainRootAction.ALLOW_AUTHENTICATED_USER") style, matching how other escape hatches in this file/package are declared) that, when true, allows authenticated users to access resource URLs instead of being rejected. Default must remain the secure blocking behaviour; anonymous resource behaviour must not change. Add javadoc explaining it is a temporary escape hatch.`,
  },
  {
    slug: 'deprecate-subtask-getlastbuilton',
    files: ['/workspace/core/src/main/java/hudson/model/queue/SubTask.java'],
    hint: `Mark SubTask.getLastBuiltOn() as @Deprecated (and add @Deprecated javadoc explaining it is no longer part of the supported scheduling contract and Jenkins no longer relies on it). Do not change behaviour. Also add a "@deprecated" javadoc tag. If the interface has a default implementation keep it.`,
  },
  {
    slug: 'peepholepermalink-cache-extension',
    files: ['/workspace/core/src/main/java/jenkins/model/PeepholePermalink.java'],
    hint: `Expose the permalink cache as an ExtensionPoint: add a nested "Cache" interface (annotated @Restricted(Beta.class) if that idiom is used nearby, and extending ExtensionPoint) with methods to load/save/clear a cached permalink target, plus a default implementation nested class that keeps the current on-disk behaviour. Persisted entries MUST keep the exact storage shape id + " " + (build == null ? -1 : build.getNumber()). Also make sure resolveNearestBuild / nearest-old-build resolution preserves exact numeric semantics when build numbers are missing (use -1 sentinel consistently). Read the whole file first and keep all existing public behaviour.`,
  },
  {
    slug: 'user-reload-beta-api',
    files: ['/workspace/core/src/main/java/hudson/model/User.java'],
    hint: `Mark User.reload() as beta API using the same idiom the codebase already uses for beta APIs: @Restricted(Beta.class) from org.kohsuke.accmod / io.jenkins.lib.versionnumber? -- check other core classes for the exact annotation used for beta APIs (it is org.kohsuke.accmod.Restricted with org.kohsuke.accmod.restrictions.Beta). Add javadoc noting it is beta. Behaviour unchanged.`,
  },
  {
    slug: 'build-number-assigner',
    files: ['/workspace/core/src/main/java/hudson/model/Job.java'],
    hint: `Add a Job.BuildNumberAssigner ExtensionPoint: a nested public interface (or abstract class) annotated as an ExtensionPoint with a method that assigns the next build number for a Job, plus a nested SaveNextBuildNumber callback type that lets the assigner persist the sequence. Refactor Job.assignBuildNumber() (find the current hard-wired nextBuildNumber allocation logic) to delegate to the first available BuildNumberAssigner extension, falling back to the current built-in behaviour as the default implementation (e.g. a nested Default class annotated @Extension with @Symbol, or ExtensionList.lookupFirst). Mark the new API @Restricted(Beta.class) if that matches nearby idiom, and add @since TODO javadoc tags.`,
  },
]

phase('Implement')
const results = await parallel(REQS.map((r) => () =>
  agent(
    COMMON.replaceAll('<SLUG>', r.slug) +
    `\n\nSLUG: ${r.slug}\nALLOWED FILES:\n${r.files.map((f) => ' - ' + f).join('\n')}\n\nIMPLEMENTATION GUIDANCE:\n${r.hint}\n`,
    { label: r.slug, phase: 'Implement' }
  ).then((text) => ({ slug: r.slug, report: text }))
))

return results.filter(Boolean)
