// Product capability gates are source-owned build facts. They are not read
// from user preferences, environment variables, project files, or Provider
// responses. PR4 keeps Codex execution disabled in ordinary builds; PR5 may
// enable it only after packaged-runtime and installed-app evidence passes.
export const AGENT_FEATURE_GATES = Object.freeze({
  codexDiscussion: false,
  codexExecution: false,
});
