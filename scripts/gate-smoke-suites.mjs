export const GATE_SMOKE_TAG = "@gate-smoke";

export const CAPABILITY_SMOKE_SUITES = {
  "browser-editing-smoke": {
    runtime: "browser",
    tag: "@smoke-editing",
    config: "tests/e2e/browser/playwright.smoke.config.mjs",
  },
  "browser-comments-smoke": {
    runtime: "browser",
    tag: "@smoke-comments",
    config: "tests/e2e/browser/playwright.smoke.config.mjs",
  },
  "browser-review-smoke": {
    runtime: "browser",
    tag: "@smoke-review",
    config: "tests/e2e/browser/playwright.smoke.config.mjs",
  },
  "electron-editing-smoke": {
    runtime: "electron",
    tag: "@smoke-editing",
    config: "tests/e2e/electron/playwright.smoke.config.mjs",
  },
  "electron-project-lifecycle-smoke": {
    runtime: "electron",
    tag: "@smoke-project-lifecycle",
    config: "tests/e2e/electron/playwright.smoke.config.mjs",
  },
  "electron-recovery-smoke": {
    runtime: "electron",
    tag: "@smoke-recovery",
    config: "tests/e2e/electron/playwright.smoke.config.mjs",
  },
  "electron-agent-smoke": {
    runtime: "electron",
    tag: "@smoke-agent",
    config: "tests/e2e/electron/playwright.smoke.config.mjs",
  },
  "ai-review-smoke": {
    runtime: "ai",
    tag: "@smoke-review",
    config: "tests/e2e/electron/playwright.ai-smoke.config.mjs",
  },
  "ai-provider-smoke": {
    runtime: "ai",
    tag: "@smoke-provider",
    config: "tests/e2e/electron/playwright.ai-smoke.config.mjs",
  },
  "ai-run-lifecycle-smoke": {
    runtime: "ai",
    tag: "@smoke-run-lifecycle",
    config: "tests/e2e/electron/playwright.ai-smoke.config.mjs",
  },
  "browser-smoke": {
    runtime: "browser",
    tag: GATE_SMOKE_TAG,
    config: "tests/e2e/browser/playwright.smoke.config.mjs",
  },
  "electron-smoke": {
    runtime: "electron",
    tag: GATE_SMOKE_TAG,
    config: "tests/e2e/electron/playwright.smoke.config.mjs",
  },
  "ai-smoke": {
    runtime: "ai",
    tag: GATE_SMOKE_TAG,
    config: "tests/e2e/electron/playwright.ai-smoke.config.mjs",
  },
};

export const GATE_WIDTH_LIMITS = {
  leafFileNodeTests: 8,
  ruleProductionModules: 10,
};

export function isRuntimeCanarySuite(suiteId) {
  return Boolean(CAPABILITY_SMOKE_SUITES[suiteId]);
}

export function runtimeOfSuite(suiteId) {
  return CAPABILITY_SMOKE_SUITES[suiteId]?.runtime || null;
}

export function tagOfSuite(suiteId) {
  return CAPABILITY_SMOKE_SUITES[suiteId]?.tag || null;
}

export function countTagOccurrences(source, tag) {
  const needle = JSON.stringify(tag);
  let count = 0;
  let index = 0;
  while (index < source.length) {
    const found = source.indexOf(needle, index);
    if (found < 0) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}
