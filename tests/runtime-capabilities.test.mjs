import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_RUNTIME_CAPABILITIES,
  DESKTOP_RUNTIME_CAPABILITIES,
  assertDesktopHost,
  resolveRuntimeCapabilities,
} from "../app/application/runtime-capabilities.js";

function desktopHost(overrides = {}) {
  return {
    htmlAIRuntime: { capabilities: { ...DESKTOP_RUNTIME_CAPABILITIES } },
    htmlAIProjects: {
      getActiveProject() {},
      openHtml() {},
    },
    htmlAIPreview: {
      createSession() {},
      revokeSession() {},
    },
    htmlAIAppLifecycle: {
      onPrepareClose() {},
      onCloseAborted() {},
      reportReady() {},
      reportBlocked() {},
    },
    ...overrides,
  };
}

test("the production renderer admits only a complete Desktop host", () => {
  assert.equal(assertDesktopHost(desktopHost()), DESKTOP_RUNTIME_CAPABILITIES);
});

test("the production renderer rejects a browser capability fallback", () => {
  assert.throws(
    () => assertDesktopHost(desktopHost({
      htmlAIRuntime: { capabilities: { ...BROWSER_RUNTIME_CAPABILITIES } },
    })),
    /桌面运行环境未初始化/u,
  );
});

test("the production renderer names a missing Desktop preload function", () => {
  assert.throws(
    () => assertDesktopHost(desktopHost({
      htmlAIPreview: { createSession() {} },
    })),
    /htmlAIPreview\.revokeSession/u,
  );
});

test("missing manifests fail closed even when an old projects API is present", () => {
  assert.deepEqual(
    resolveRuntimeCapabilities({
      projectsApi: {
        openHtml() {},
        listRecentProjects() {},
        openRecent() {},
      },
    }),
    BROWSER_RUNTIME_CAPABILITIES,
  );
});

test("the explicit desktop manifest owns editor, picker, attachment, and close capabilities", () => {
  const resolved = resolveRuntimeCapabilities({
    runtimeConfig: {
      capabilities: {
        sourceEditing: "enabled",
        projectOpening: "desktop-dialog",
        attachmentPersistence: "bridge",
        closeCoordination: "electron-handshake",
        interactivePreview: "independent-url",
      },
    },
  });
  assert.deepEqual(resolved, DESKTOP_RUNTIME_CAPABILITIES);
  assert.equal(Object.isFrozen(resolved), true);
});

test("the browser editing harness declares only the capabilities it exercises", () => {
  assert.deepEqual(
    resolveRuntimeCapabilities({
      runtimeConfig: {
        capabilities: {
          sourceEditing: "enabled",
          projectOpening: "browser-file",
        attachmentPersistence: "memory",
        closeCoordination: "browser-beforeunload",
        interactivePreview: "srcdoc",
        },
      },
    }),
    {
      sourceEditing: "enabled",
      projectOpening: "browser-file",
      attachmentPersistence: "memory",
      closeCoordination: "browser-beforeunload",
      interactivePreview: "srcdoc",
    },
  );
});

test("an invalid explicit manifest fails closed instead of guessing from APIs", () => {
  assert.deepEqual(
    resolveRuntimeCapabilities({
      runtimeConfig: {
        capabilities: {
          sourceEditing: "enabled",
          projectOpening: "desktop-dialog",
          attachmentPersistence: "unknown",
          closeCoordination: "electron-handshake",
          interactivePreview: "independent-url",
        },
      },
    }),
    BROWSER_RUNTIME_CAPABILITIES,
  );
});
