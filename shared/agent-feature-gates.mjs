// Product capability gates are source-owned build facts. They are not read
// from user preferences, environment variables, project files, or Provider
// responses. Pure Agent discussion remains disabled; executable Providers are
// registered through the shared ACP runtime.
export const AGENT_FEATURE_GATES = Object.freeze({
  codexDiscussion: false,
});
