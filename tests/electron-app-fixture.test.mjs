import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
  decodeUiPreferences,
} from "../desktop/ui-preferences.mjs";
import {
  closeObservationTimeout,
  createCloseFirstCleanup,
  seedDismissedFirstEditGuide,
  waitForMainBrowserWindow,
} from "./e2e/electron/helpers/pageroot-app-fixture.mjs";

test("Electron app fixture waits for the matching native BrowserWindow registration", async () => {
  let evaluations = 0;
  const expected = { focused: false, visible: false };
  const nativeWindow = await waitForMainBrowserWindow({
    evaluate: async (_callback, rendererUrl) => {
      assert.equal(rendererUrl, "file:///pageroot/index.html");
      evaluations += 1;
      return evaluations === 1 ? null : expected;
    },
  }, "file:///pageroot/index.html", { timeout: 1_000 });

  assert.equal(evaluations, 2);
  assert.deepEqual(nativeWindow, expected);
});

test("Electron app fixture keeps its close listener alive through the forced-termination budget", () => {
  assert.equal(closeObservationTimeout(), 7_000);
  assert.equal(closeObservationTimeout(10_000), 10_000);
});

test("Electron app fixture observes close before cleanup and makes stop idempotent", async () => {
  const events = [];
  const stop = createCloseFirstCleanup({
    requestExit: async () => events.push("exit-request"),
    waitForExit: async () => {
      events.push("process-exit");
      return true;
    },
    waitForClose: async () => {
      events.push("electron-close");
      return true;
    },
    terminate: async (signal) => events.push(`terminate:${signal}`),
    cleanup: async () => events.push("cleanup"),
  });

  await Promise.all([stop(), stop()]);

  assert.deepEqual(events, [
    "exit-request",
    "process-exit",
    "electron-close",
    "cleanup",
  ]);
});

test("Electron app fixture uses bounded SIGTERM and SIGKILL fallbacks before cleanup", async () => {
  const events = [];
  let exitPolls = 0;
  const stop = createCloseFirstCleanup({
    requestExit: async () => events.push("exit-request"),
    waitForExit: async () => {
      exitPolls += 1;
      return exitPolls >= 3;
    },
    waitForClose: async () => {
      events.push("electron-close");
      return true;
    },
    terminate: async (signal) => events.push(`terminate:${signal}`),
    cleanup: async () => events.push("cleanup"),
    exitTimeout: 1,
    terminateTimeout: 1,
  });

  await stop();

  assert.deepEqual(events, [
    "exit-request",
    "terminate:SIGTERM",
    "terminate:SIGKILL",
    "electron-close",
    "cleanup",
  ]);
});

test("Electron app fixture preserves Bridge-owned files when neither close nor process exit is observed", async () => {
  const events = [];
  const stop = createCloseFirstCleanup({
    requestExit: async () => events.push("exit-request"),
    waitForExit: async () => false,
    waitForClose: async () => false,
    terminate: async (signal) => events.push(`terminate:${signal}`),
    cleanup: async () => events.push("cleanup"),
  });

  await assert.rejects(stop, /exit could not be confirmed/u);
  assert.deepEqual(events, [
    "exit-request",
    "terminate:SIGTERM",
    "terminate:SIGKILL",
  ]);
});

test("Electron app fixture cleans up after confirmed process exit when the close event is missed", async () => {
  const events = [];
  const stop = createCloseFirstCleanup({
    requestExit: async () => events.push("exit-request"),
    waitForExit: async () => {
      events.push("process-exit");
      return true;
    },
    waitForClose: async () => false,
    terminate: async (signal) => events.push(`terminate:${signal}`),
    cleanup: async () => events.push("cleanup"),
  });

  await stop();
  assert.deepEqual(events, ["exit-request", "process-exit", "cleanup"]);
});

test("Electron app fixture can opt an E2E launch back into the first-edit guide port", () => {
  const fixture = readFileSync(
    new URL("./e2e/electron/helpers/pageroot-app-fixture.mjs", import.meta.url),
    "utf8",
  );
  assert.match(fixture, /PAGEROOT_E2E_FIRST_EDIT_GUIDE: "1"/u);
});

test("Electron app fixture seeds a dismissed first-edit guide for isolated profiles", () => {
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-guide-seed-"));
  seedDismissedFirstEditGuide(isolatedUserData);
  const preferences = decodeUiPreferences(
    readFileSync(path.join(isolatedUserData, "ui-preferences.json"), "utf8"),
  );
  assert.equal(preferences.firstRealHtmlEditGuide.status, "dismissed");
  assert.equal(
    preferences.firstRealHtmlEditGuide.generation,
    FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
  );
});
