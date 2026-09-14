import assert from "node:assert/strict";
import test from "node:test";

import { assertDesktopHost } from "../app/application/desktop-host.js";

function desktopHost() {
  return {
    stemmioRuntime: {
      capabilities: {
        sourceEditing: "enabled",
        projectOpening: "desktop-dialog",
        attachmentPersistence: "bridge",
        closeCoordination: "electron-handshake",
        interactivePreview: "independent-url",
      },
    },
    stemmioProjects: { getActiveProject() {}, openHtml() {} },
    stemmioPreview: { createSession() {}, revokeSession() {} },
    stemmioAppLifecycle: {
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
  host.stemmioRuntime.capabilities.projectOpening = "other";
  assert.throws(() => assertDesktopHost(host), /能力声明缺失或无效/u);
});

test("desktop host assertion reports missing required preload functions", () => {
  const host = desktopHost();
  delete host.stemmioPreview.createSession;
  assert.throws(() => assertDesktopHost(host), /stemmioPreview\.createSession/u);
});
