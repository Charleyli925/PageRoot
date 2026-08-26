// Product capability gates are source-owned build facts. They are not read
// from user preferences, environment variables, project files, or Provider
// responses. Codex execution is enabled only because its pinned runtime,
// Candidate boundary, packaged-artifact verification and rollback contract are
// owned by the same source revision.
export const AGENT_FEATURE_GATES = Object.freeze({
  codexDiscussion: false,
  codexExecution: true,
});
