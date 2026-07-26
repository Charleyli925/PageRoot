import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_RUNTIME_CAPABILITIES,
  DESKTOP_RUNTIME_CAPABILITIES,
  resolveRuntimeCapabilities,
} from "../app/application/runtime-capabilities.js";

test("pure browser runtime is read-only and has no persistence authority", () => {
  assert.deepEqual(resolveRuntimeCapabilities(), BROWSER_RUNTIME_CAPABILITIES);
});

test("the explicit desktop manifest owns editor, picker, and attachment capabilities", () => {
  const resolved = resolveRuntimeCapabilities({
    runtimeConfig: {
      capabilities: {
        sourceEditing: "enabled",
        projectOpening: "desktop-dialog",
        attachmentPersistence: "bridge",
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
        },
      },
    }),
    {
      sourceEditing: "enabled",
      projectOpening: "browser-file",
      attachmentPersistence: "memory",
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
        },
      },
      projectsApi: {
        openHtml() {},
        listRecentProjects() {},
        openRecent() {},
      },
    }),
    BROWSER_RUNTIME_CAPABILITIES,
  );
});

test("the pre-manifest desktop API is decoded only at the compatibility ingress", () => {
  assert.deepEqual(
    resolveRuntimeCapabilities({
      projectsApi: {
        openHtml() {},
        listRecentProjects() {},
        openRecent() {},
      },
    }),
    DESKTOP_RUNTIME_CAPABILITIES,
  );
});
