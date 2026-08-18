import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
  decodeUiPreferences,
} from "../desktop/ui-preferences.mjs";
import {
  classifyRendererMount,
  closeObservationTimeout,
  collectProjectReadinessDiagnostics,
  createCloseFirstCleanup,
  describeRendererReadiness,
  ensureRendererMounted,
  launchPageRoot,
  seedDismissedFirstEditGuide,
  waitForMainBrowserWindow,
} from "./e2e/electron/helpers/pageroot-app-fixture.mjs";

test("Electron app fixture captures bounded, secret-safe readiness evidence without retrying", async () => {
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-diagnostics-"));
  const workspace = path.join(isolatedUserData, "workspace");
  const projectFilesRoot = path.join(isolatedUserData, "project-files");
  try {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(path.join(projectFilesRoot, "demo", ".pageroot"), { recursive: true });
    writeFileSync(path.join(isolatedUserData, "html-projects.json"), JSON.stringify({
      version: 1,
      activePath: "/tmp/demo.html",
      recent: [{ path: "/tmp/demo.html", name: "demo.html" }],
    }));
    writeFileSync(path.join(workspace, "project-registry.json"), JSON.stringify({
      schemaVersion: "3.0.0",
      projects: {},
    }), { flag: "w" });
    writeFileSync(path.join(projectFilesRoot, "demo", ".pageroot", "project.json"), JSON.stringify({
      projectId: "project_demo",
      documentId: "document_demo",
    }));
    writeFileSync(path.join(projectFilesRoot, "demo", ".pageroot", "manifest.json"), JSON.stringify({
      projectId: "project_demo",
      latestOfficialVersionId: "ver_0001",
    }));

    const visibleFailure = `failure-${"x".repeat(5_000)}-bridgeAuthToken=visible-secret`;
    const diagnostics = await collectProjectReadinessDiagnostics({
      url: () => "file:///pageroot/index.html?bridgeAuthToken=page-secret",
      evaluate: async () => ({
        url: "file:///pageroot/index.html?bridgeAuthToken=document-secret",
        readyState: "complete",
        visibilityState: "visible",
        title: "源页 bridgeAuthToken=title-secret",
        workbench: { exists: false, projectState: "bridgeAuthToken=project-state-secret" },
        hydrationStage: "bridgeAuthToken=stage-secret",
        visibleFailure: { text: visibleFailure, visible: true },
        root: { exists: true, childElementCount: 0, childTags: [] },
        projectApiPresent: true,
      }),
    }, {
      electronApp: {
        evaluate: async () => [{
          id: 7,
          focused: false,
          visible: false,
          minimized: false,
          destroyed: false,
          url: "file:///pageroot/index.html?bridgeAuthToken=window-secret",
          loading: false,
          crashed: false,
          processId: 42,
        }],
      },
      isolatedUserData,
      workspace,
      projectFilesRoot,
      mainRendererUrl: "file:///pageroot/index.html?bridgeAuthToken=launch-secret",
      rendererMount: { reloaded: false },
      processDiagnostics: {
        stdout: ["main stdout bridgeAuthToken=", "stdout-secret"],
        stderr: ["main stderr bridgeAuthToken=stderr-secret"],
      },
      rendererDiagnostics: {
        console: ["warning: renderer warning bridgeAuthToken=console-secret"],
        pageErrors: ["renderer error"],
        lifecycle: [],
      },
    });

    assert.equal(diagnostics.renderer.document.workbench.exists, false);
    assert.equal(diagnostics.nativeWindows[0].id, 7);
    assert.deepEqual(diagnostics.mainProcess, {
      stdout: ["main stdout bridgeAuthToken=[redacted]"],
      stderr: ["main stderr bridgeAuthToken=[redacted]"],
    });
    assert.equal(diagnostics.isolatedRegistry.activeDiskProject.value.activePath, "/tmp/demo.html");
    assert.equal(diagnostics.isolatedRegistry.projectFiles.projects[0].name, "demo");
    assert.deepEqual(diagnostics.launch.rendererMount, { reloaded: false });
    assert.ok(diagnostics.renderer.document.visibleFailure.text.length <= 1_001);
    assert.match(diagnostics.renderer.document.visibleFailure.text, /bridgeAuthToken=\[redacted\]/u);
    assert.doesNotMatch(
      JSON.stringify(diagnostics),
      /(?:page|document|window|launch|title|project-state|stage|visible|stdout|stderr|console)-secret/u,
    );
    assert.match(diagnostics.nativeWindows[0].url, /bridgeAuthToken=\[redacted\]/u);
  } finally {
    rmSync(isolatedUserData, { recursive: true, force: true });
  }
});

test("Electron app fixture bounds hung readiness diagnostics instead of blocking failure cleanup", async () => {
  const never = new Promise(() => {});
  const startedAt = Date.now();
  const diagnostics = await collectProjectReadinessDiagnostics({
    url: () => "file:///pageroot/index.html",
    evaluate: () => never,
  }, {
    electronApp: { evaluate: () => never },
    diagnosticTimeout: 20,
  });

  assert.ok(Date.now() - startedAt < 250);
  assert.match(diagnostics.renderer.documentError, /renderer readiness snapshot timed out after 20ms/u);
  assert.match(diagnostics.nativeWindows.error, /native BrowserWindow snapshot timed out after 20ms/u);
});

test("Electron app fixture bounds a missing first window and preserves launch diagnostics before shutdown", async () => {
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-first-window-"));
  const electronApp = {
    process: () => ({}),
    firstWindow: () => new Promise(() => {}),
  };
  let shutdown = null;
  try {
    await assert.rejects(
      launchPageRoot({
        isolatedUserData,
        electronLauncher: async () => electronApp,
        shutdown: async (app, userData, options) => {
          shutdown = { app, userData, options };
        },
        firstWindowTimeout: 20,
        diagnosticTimeout: 20,
      }),
      /PageRoot first window timed out after 20ms/u,
    );
    assert.deepEqual(shutdown, {
      app: electronApp,
      userData: isolatedUserData,
      options: { cleanup: false },
    });
  } finally {
    rmSync(isolatedUserData, { recursive: true, force: true });
  }
});

test("Electron app fixture reports an empty renderer root without reloading", async () => {
  let evaluations = 0;
  let reloads = 0;
  const page = {
    evaluate: async () => {
      evaluations += 1;
      return reloads > 0;
    },
    reload: async () => {
      reloads += 1;
    },
  };
  await assert.rejects(
    ensureRendererMounted(page, { timeout: 250 }),
    /did not mount during initial launch/u,
  );
  assert.equal(reloads, 0);
  assert.ok(evaluations >= 2);
});

test("a live document that drops a mounted workbench is a renderer fault", () => {
  // Startup before the first mount must keep waiting.
  assert.equal(classifyRendererMount({
    mounted: false,
    mountObservedForDocument: false,
    documentReplaced: false,
  }), "pending");
  assert.equal(classifyRendererMount({
    mounted: true,
    mountObservedForDocument: false,
    documentReplaced: false,
  }), "mounted");
  // The launch path reloads a renderer that stayed empty, so a replaced
  // document is legitimate and must not be reported as a fault.
  assert.equal(classifyRendererMount({
    mounted: false,
    mountObservedForDocument: true,
    documentReplaced: true,
  }), "document-replaced");
  // Same document, mount gone: React tore the root down.
  assert.equal(classifyRendererMount({
    mounted: false,
    mountObservedForDocument: true,
    documentReplaced: false,
  }), "torn-down");
});

test("renderer readiness failures name the captured renderer faults", () => {
  const message = describeRendererReadiness(
    "PageRoot renderer unmounted the workbench it had already mounted.",
    {
      documentId: "doc-1",
      mounted: false,
      projectState: null,
      hydrationStage: "verify-rendered",
      rootChildren: 0,
    },
    ["pageerror: Cannot read properties of undefined"],
    { documentNote: "unchanged (doc-1)" },
  );
  assert.match(message, /unmounted the workbench/u);
  assert.match(message, /hydration stage: verify-rendered/u);
  assert.match(message, /#root child elements: 0/u);
  assert.match(message, /document: unchanged \(doc-1\)/u);
  assert.match(message, /renderer faults: 1 captured/u);
  assert.match(message, /Cannot read properties of undefined/u);
  // An absent snapshot must still produce a readable report.
  assert.match(
    describeRendererReadiness("timed out", null, []),
    /project state: absent[\s\S]*renderer faults: none captured/u,
  );
});

test("Electron app fixture bounds a hung renderer mount probe without reloading", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    ensureRendererMounted({ evaluate: () => new Promise(() => {}) }, { timeout: 20 }),
    /did not mount during initial launch/u,
  );
  assert.ok(Date.now() - startedAt < 250);
});

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
