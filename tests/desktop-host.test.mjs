import assert from "node:assert/strict";
import test from "node:test";

import { assertDesktopHost } from "../app/application/desktop-host.js";

function desktopHost() {
  return {
    htmlAIRuntime: {
      capabilities: {
        sourceEditing: "enabled",
        projectOpening: "desktop-dialog",
        attachmentPersistence: "bridge",
        closeCoordination: "electron-handshake",
        interactivePreview: "independent-url",
      },
    },
    htmlAIProjects: { getActiveProject() {}, openHtml() {} },
    htmlAIPreview: { createSession() {}, revokeSession() {} },
    htmlAIAppLifecycle: {
      onPrepareClose() {},
      onCloseAborted() {},
      reportReady() {},
      reportBlocked() {},
    },
  };
}

test("desktop host assertion accepts the complete preload contract", () => {
  assert.doesNotThrow(() => assertDesktopHost(desktopHost()));
});

test("desktop host assertion fails closed for a malformed manifest", () => {
  const host = desktopHost();
  host.htmlAIRuntime.capabilities.projectOpening = "other";
  assert.throws(() => assertDesktopHost(host), /能力声明缺失或无效/u);
});

test("desktop host assertion reports missing required preload functions", () => {
  const host = desktopHost();
  delete host.htmlAIPreview.createSession;
  assert.throws(() => assertDesktopHost(host), /htmlAIPreview\.createSession/u);
});
