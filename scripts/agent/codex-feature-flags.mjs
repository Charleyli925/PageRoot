export const CODEX_BUILD_GATES = Object.freeze({
  codexDiscussion: true,
  codexExecution: true,
});

export function resolveCodexFeatureFlags({
  environment = process.env,
  buildGates = CODEX_BUILD_GATES,
} = {}) {
  const testOverride = environment.PAGEROOT_E2E === "1"
    && environment.PAGEROOT_CODEX_ALLOW_TEST_FLAGS === "1";
  const discussionRequested = testOverride
    && environment.PAGEROOT_CODEX_DISCUSSION === "1";
  const executionRequested = testOverride
    && environment.PAGEROOT_CODEX_EXECUTION === "1";
  return Object.freeze({
    codexDiscussion: buildGates.codexDiscussion === true || discussionRequested,
    codexExecution: buildGates.codexExecution === true || executionRequested,
  });
}
