import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import {
  PROJECT_IPC_PROTOCOL,
  PROJECT_IPC_VERSION,
} from "../desktop/export-copy.mjs";

async function loadPreloadApis(invoke) {
  const source = await readFile(
    new URL("../desktop/preload.mjs", import.meta.url),
    "utf8",
  );
  const exposed = new Map();
  const listeners = new Map();
  const sent = [];
  const ipcRenderer = {
    invoke,
    send(...args) {
      sent.push(args);
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed.set(name, value);
    },
  };
  const context = vm.createContext({
    console,
    location: { search: "" },
    URLSearchParams,
    require(specifier) {
      assert.equal(specifier, "electron");
      return { contextBridge, ipcRenderer };
    },
  });
  vm.runInContext(source, context, {
    filename: "desktop/preload.mjs",
  });
  return {
    projects: exposed.get("htmlAIProjects"),
    integrations: exposed.get("htmlAIIntegrations"),
    updates: exposed.get("htmlAIUpdates"),
    runtime: exposed.get("htmlAIRuntime"),
    lifecycle: exposed.get("htmlAIAppLifecycle"),
    usage: exposed.get("htmlAIUsage"),
    preview: exposed.get("htmlAIPreview"),
    editVisuals: exposed.get("htmlAIEditVisuals"),
    reviewRuntimeVisuals: exposed.get("htmlAIReviewRuntimeVisuals"),
    edit: exposed.get("htmlAIEdit"),
    sent,
    emit(channel, payload) {
      listeners.get(channel)?.({}, payload);
    },
  };
}

async function loadPreload(invoke) {
  return (await loadPreloadApis(invoke)).projects;
}

function success(value) {
  return {
    protocol: PROJECT_IPC_PROTOCOL,
    version: PROJECT_IPC_VERSION,
    ok: true,
    value,
  };
}

test("preload declares one immutable desktop runtime capability manifest", async () => {
  const { runtime } = await loadPreloadApis(async () => success(null));
  assert.equal(runtime.capabilities.sourceEditing, "enabled");
  assert.equal(runtime.capabilities.projectOpening, "desktop-dialog");
  assert.equal(runtime.capabilities.attachmentPersistence, "bridge");
  assert.equal(runtime.capabilities.closeCoordination, "electron-handshake");
  assert.equal(runtime.capabilities.interactivePreview, "independent-url");
  assert.equal(runtime.capabilities.editVisualProjection, "offscreen-capture");
  assert.equal(runtime.capabilities.reviewRuntimeVisualCapture, "owner-isolated");
  assert.equal(Object.isFrozen(runtime.capabilities), true);
});

test("preload exposes one narrow owner-controlled review runtime capture method", async () => {
  const calls = [];
  const { reviewRuntimeVisuals } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({ outcome: "failed", reason: "capture-failed" });
  });
  const payload = {
    contractVersion: 1,
    captureSessionId: "review-owner-session-0001",
    sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    side: "before",
    html: "<!doctype html><main></main>",
    candidates: [],
    viewport: { width: 960, height: 640 },
  };

  assert.deepEqual(
    await reviewRuntimeVisuals.capture(payload),
    { outcome: "failed", reason: "capture-failed" },
  );
  assert.deepEqual(calls, [["html-review-runtime-visuals:capture", payload]]);
  assert.deepEqual(Object.keys(reviewRuntimeVisuals), ["capture"]);
});

test("preload exposes one narrow edit visual capture method", async () => {
  const calls = [];
  const { editVisuals } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({
      protocol: "pageroot-runtime-visual-projection",
      version: 2,
      sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      visuals: [],
    });
  });
  const payload = {
    html: "<!doctype html><div></div>",
    sourcePath: "/Users/demo/report.html",
  };

  await editVisuals.captureProjection(payload);
  assert.deepEqual(calls, [[
    "html-edit-visuals:capture-projection",
    payload,
  ]]);
  assert.deepEqual(Object.keys(editVisuals), ["captureProjection"]);
});

test("preload exposes only preview session creation and revocation", async () => {
  const calls = [];
  const { preview } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-preview:create-session") {
      return success({
        sessionId: "0123456789abcdef0123456789abcdef",
        url: "pageroot-preview://0123456789abcdef0123456789abcdef/index.html",
      });
    }
    return success({ revoked: true });
  });
  const payload = {
    html: "<!doctype html><p>preview</p>",
    bootstrapJavaScript: "void 0;",
    sourcePath: "/Users/demo/report.html",
  };

  assert.deepEqual(
    await preview.createSession(payload),
    {
      sessionId: "0123456789abcdef0123456789abcdef",
      url: "pageroot-preview://0123456789abcdef0123456789abcdef/index.html",
    },
  );
  assert.deepEqual(calls[0], ["html-preview:create-session", payload]);
  assert.deepEqual(
    await preview.revokeSession("0123456789abcdef0123456789abcdef"),
    { revoked: true },
  );
  assert.deepEqual(calls[1], [
    "html-preview:revoke-session",
    "0123456789abcdef0123456789abcdef",
  ]);
  assert.deepEqual(Object.keys(preview).sort(), [
    "createSession",
    "revokeSession",
  ]);
});

test("preload exposes one fire-and-forget usage channel with a narrow payload", async () => {
  const preload = await loadPreloadApis(async () => success(null));
  preload.usage.capture(
    "notification_presented",
    {
      notice_code: "source_reload",
      tone: "warning",
      disposition: "direct-action",
      surface: "global",
      has_action: true,
    },
    "project_demo",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(preload.sent)),
    [[
      "html-usage:capture",
      {
        event: "notification_presented",
        properties: {
          notice_code: "source_reload",
          tone: "warning",
          disposition: "direct-action",
          surface: "global",
          has_action: true,
        },
        projectId: "project_demo",
      },
    ]],
  );

  preload.usage.capture(
    "renderer_fault",
    { nested: { raw: "not allowed" } },
    "project_demo",
  );
  preload.usage.capture(
    "renderer_fault",
    { kind: "window_error" },
    "/Users/demo/private.html",
  );
  assert.equal(preload.sent.length, 1);
  assert.deepEqual(Object.keys(preload.usage), ["capture"]);
});

test("preload exposes one narrow native/source history router", async () => {
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return { applied: true };
  });
  const requested = [];
  const unsubscribe = preload.edit.onHistoryRequested((direction) => {
    requested.push(direction);
  });
  preload.emit("html-edit:history-requested", { direction: "undo" });
  preload.emit("html-edit:history-requested", { direction: "invalid" });
  assert.deepEqual(requested, ["undo"]);
  assert.deepEqual(
    await preload.edit.runNativeHistory("redo"),
    { applied: true },
  );
  assert.deepEqual(calls, [["html-edit:native-history", "redo"]]);
  assert.throws(
    () => preload.edit.runNativeHistory("invalid"),
    /direction must be undo or redo/,
  );
  unsubscribe();
  preload.emit("html-edit:history-requested", { direction: "redo" });
  assert.deepEqual(requested, ["undo"]);
});

test("preload unwraps structured project IPC success results", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success([{ name: "demo.html" }]);
  });

  assert.deepEqual(
    await api.listRecentProjects(),
    [{ name: "demo.html" }],
  );
  assert.equal(calls[0][0], "html-projects:list-recent");
});

test("preload exposes the structured Finder reveal operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ sourcePath: "/Users/demo/report.html" });
  });

  assert.deepEqual(
    await api.showInFolder("/Users/demo/report.html"),
    { sourcePath: "/Users/demo/report.html" },
  );
  assert.deepEqual(calls[0], [
    "html-projects:show-in-folder",
    "/Users/demo/report.html",
  ]);
});

test("preload exposes the narrow default-browser HTML operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ sourcePath: "/Users/demo/report.html" });
  });

  assert.deepEqual(
    await api.openInDefaultBrowser("/Users/demo/report.html"),
    { sourcePath: "/Users/demo/report.html" },
  );
  assert.deepEqual(calls[0], [
    "html-projects:open-in-default-browser",
    "/Users/demo/report.html",
  ]);
});

test("preload exposes the narrow source rename operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/新名称.html",
      previousSourcePath: "/Users/demo/report.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operationId: "rename_demo_operation",
    });
  });
  const payload = {
    operationId: "rename_demo_operation",
    sourcePath: "/Users/demo/report.html",
    stem: "新名称",
    expectedSha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };

  assert.deepEqual(
    await api.renameHtml(payload),
    {
      sourcePath: "/Users/demo/新名称.html",
      previousSourcePath: "/Users/demo/report.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operationId: "rename_demo_operation",
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:rename",
    payload,
  ]);
});

test("preload exposes explicit recent-record removal", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ sourcePath: "/Users/demo/moved.html" });
  });

  assert.deepEqual(
    await api.forgetRecent("/Users/demo/moved.html"),
    { sourcePath: "/Users/demo/moved.html" },
  );
  assert.deepEqual(calls[0], [
    "html-projects:forget-recent",
    "/Users/demo/moved.html",
  ]);
});

test("preload accepts only an opaque main-process external-open request", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ sourcePath: "/Users/demo/qoder-output.html" });
  });

  assert.deepEqual(
    await api.acceptExternalOpen("external_request_1"),
    { sourcePath: "/Users/demo/qoder-output.html" },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    "html-projects:accept-external-open",
    { requestId: "external_request_1" },
  ]);
});

test("preload replays a pending external-open request and receives later requests", async () => {
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-app:external-open-ready") {
      return {
        requestId: "external_startup",
        sourcePath: "/Users/demo/startup.html",
      };
    }
    return null;
  });
  const requests = [];
  const unsubscribe = preload.lifecycle.onExternalOpenRequested((request) => {
    requests.push(request);
  });
  await new Promise((resolve) => setImmediate(resolve));
  preload.emit("html-app:external-open-requested", {
    requestId: "external_live",
    sourcePath: "/Users/demo/live.html",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    {
      requestId: "external_startup",
      sourcePath: "/Users/demo/startup.html",
    },
    {
      requestId: "external_live",
      sourcePath: "/Users/demo/live.html",
    },
  ]);
  assert.deepEqual(calls, [["html-app:external-open-ready"]]);
  unsubscribe();
});

test("preload ignores a stale external-open catch-up after a newer live delivery", async () => {
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-app:external-open-ready") return ready;
    return null;
  });
  const requests = [];
  const unsubscribe = preload.lifecycle.onExternalOpenRequested((request) => {
    requests.push(request);
  });
  await new Promise((resolve) => setImmediate(resolve));

  preload.emit("html-app:external-open-requested", {
    requestId: "external_live",
    sourcePath: "/Users/demo/live.html",
  });
  resolveReady({
    requestId: "external_startup",
    sourcePath: "/Users/demo/startup.html",
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{
    requestId: "external_live",
    sourcePath: "/Users/demo/live.html",
  }]);
  assert.deepEqual(calls, [["html-app:external-open-ready"]]);
  unsubscribe();
});

test("preload exposes workspace failure recovery and a narrow relaunch action", async () => {
  const calls = [];
  const preload = await loadPreloadApis(async (...args) => {
    calls.push(args);
    if (args[0] === "html-app:workspace-recovery-ready") {
      return {
        issue: {
          title: "启动期间本地项目资料不可用",
          message: "已为较晚注册的监听器保留恢复信息。",
        },
      };
    }
    return { relaunched: false };
  });
  const issues = [];
  let aboutRequests = 0;
  const unsubscribeAbout = preload.lifecycle.onAboutRequested(() => {
    aboutRequests += 1;
  });
  const unsubscribe = preload.lifecycle.onWorkspaceUnavailable((issue) => {
    issues.push(issue);
  });
  await new Promise((resolve) => setImmediate(resolve));

  preload.emit("html-app:workspace-unavailable", {
    title: "本地项目资料暂时不可用",
    message: "请先导出当前编辑。",
  });
  preload.emit("html-app:about-requested");
  assert.equal(aboutRequests, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(issues)),
    [
      {
        title: "启动期间本地项目资料不可用",
        message: "已为较晚注册的监听器保留恢复信息。",
      },
      {
        title: "本地项目资料暂时不可用",
        message: "请先导出当前编辑。",
      },
    ],
  );
  assert.deepEqual(
    await preload.lifecycle.relaunch(),
    { relaunched: false },
  );
  assert.deepEqual(calls, [
    ["html-app:workspace-recovery-ready"],
    ["html-app:relaunch"],
  ]);
  unsubscribeAbout();
  unsubscribe();
});

test("preload opens only the fixed packaged user notice", async () => {
  const calls = [];
  const { lifecycle } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({ opened: true });
  });

  assert.deepEqual(
    await lifecycle.openUserNotice(),
    { opened: true },
  );
  assert.deepEqual(calls, [["html-app:open-user-notice"]]);
});

test("preload exposes the narrow generated-version activation operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/working/report-V1.1.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      previousSourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
    });
  });
  const payload = {
    previousSourcePath: "/Users/demo/report.html",
    nextSourcePath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/working/report-V1.1.html",
    expectedSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: "project_demo",
    versionId: "ver_0002",
  };

  assert.deepEqual(
    await api.activateGeneratedVersion(payload),
    {
      sourcePath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/working/report-V1.1.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      previousSourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:activate-generated-version",
    payload,
  ]);
});

test("preload exposes the narrow history-version Finder operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
      versionPath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/versions/ver_0002/files/index.html",
    });
  });
  const payload = {
    sourcePath: "/Users/demo/report.html",
    versionId: "ver_0002",
  };

  assert.deepEqual(
    await api.revealVersionFile(payload),
    {
      sourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
      versionPath: "/Users/demo/PageRoot/项目记录/projects/report__20260728-124315__01234567/versions/ver_0002/files/index.html",
    },
  );
  assert.deepEqual(calls[0], [
    "html-projects:reveal-version-file",
    payload,
  ]);
});

test("preload exposes the narrow request-folder Finder operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({ requestPath: "/Users/demo/PageRoot/项目记录/requests/req_0001" });
  });
  const payload = {
    sourcePath: "/Users/demo/report.html",
    requestPath: "/Users/demo/PageRoot/项目记录/requests/req_0001",
  };

  assert.deepEqual(
    await api.revealRequestFolder(payload),
    { requestPath: "/Users/demo/PageRoot/项目记录/requests/req_0001" },
  );
  assert.deepEqual(calls[0], [
    "html-projects:reveal-request-folder",
    payload,
  ]);
});

test("preload never replays a failed local side-effect request", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    throw new Error("desktop operation unavailable");
  });
  const actions = [
    ["showInFolder", "/Users/demo/report.html"],
    ["openInDefaultBrowser", "/Users/demo/report.html"],
    ["revealRequestFolder", {
      sourcePath: "/Users/demo/report.html",
      requestPath: "/Users/demo/PageRoot/项目记录/requests/req_0001",
    }],
    ["revealVersionFile", {
      sourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
    }],
  ];

  for (const [method, payload] of actions) {
    const before = calls.length;
    await assert.rejects(
      () => api[method](payload),
      (error) => error?.code === "PROJECT_SERVICE_UNAVAILABLE",
    );
    assert.equal(calls.length, before + 1, `${method} must invoke once`);

    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(calls.length, before + 1, `${method} must not retry on a timer`);

    await assert.rejects(() => api[method](payload));
    assert.equal(calls.length, before + 2, `${method} runs again only for a new call`);
  }
});

test("preload exposes the narrow QoderWork handoff integration", async () => {
  const calls = [];
  const { integrations } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({
      status: "copied",
      copied: true,
      opened: false,
      pasted: false,
      reason: null,
    });
  });

  assert.deepEqual(
    await integrations.handoffToQoderWork({ message: "handoff" }),
    {
      status: "copied",
      copied: true,
      opened: false,
      pasted: false,
      reason: null,
    },
  );
  assert.deepEqual(calls[0], [
    "html-integrations:qoder-handoff",
    { message: "handoff" },
  ]);
});

test("preload exposes update status, restart installation, and the fixed release fallback", async () => {
  const calls = [];
  const { updates } = await loadPreloadApis(async (...args) => {
    calls.push(args);
    return success({ status: "current", currentVersion: "0.7.4" });
  });

  assert.deepEqual(
    await updates.getStatus(),
    { status: "current", currentVersion: "0.7.4" },
  );
  assert.deepEqual(calls[0], ["html-updates:get-status"]);

  const unsubscribe = updates.onStatus(() => {});
  assert.equal(typeof unsubscribe, "function");
  unsubscribe();

  await updates.checkNow();
  assert.deepEqual(calls[1], ["html-updates:check-now"]);

  await updates.downloadAvailable();
  assert.deepEqual(calls[2], ["html-updates:download-available"]);

  await updates.installDownloaded();
  assert.deepEqual(calls[3], ["html-updates:install-downloaded"]);

  await updates.openLatestRelease();
  assert.deepEqual(calls[4], ["html-updates:open-latest-release"]);

  await updates.openRepository();
  assert.deepEqual(calls[5], ["html-updates:open-repository"]);
  assert.deepEqual(Object.keys(updates).sort(), [
    "checkNow",
    "downloadAvailable",
    "getStatus",
    "installDownloaded",
    "onStatus",
    "openLatestRelease",
    "openRepository",
  ]);
});

test("preload exposes a clean product error without IPC implementation details", async () => {
  const api = await loadPreload(async () => ({
    protocol: PROJECT_IPC_PROTOCOL,
    version: PROJECT_IPC_VERSION,
    ok: false,
    error: {
      code: "PERMISSION_DENIED",
      message: "没有访问该位置的权限，请选择其他位置。",
    },
  }));

  await assert.rejects(
    api.exportHtmlCopy({ html: "<html></html>" }),
    (error) => {
      assert.equal(error.code, "PERMISSION_DENIED");
      assert.equal(error.message, "没有访问该位置的权限，请选择其他位置。");
      assert.doesNotMatch(
        error.message,
        /Error invoking remote method|html-projects:|ProjectFileError|stack/i,
      );
      return true;
    },
  );
});

test("preload redacts raw Electron IPC rejections and malformed responses", async () => {
  const rejectedApi = await loadPreload(async () => {
    throw new Error(
      "Error invoking remote method 'html-projects:export-copy': ProjectFileError: secret",
    );
  });
  await assert.rejects(
    rejectedApi.exportHtmlCopy({ html: "<html></html>" }),
    (error) => {
      assert.equal(error.code, "PROJECT_SERVICE_UNAVAILABLE");
      assert.equal(error.message, "本地文件服务暂时不可用，请重试。");
      assert.doesNotMatch(
        error.message,
        /remote method|html-projects:|ProjectFileError|secret/i,
      );
      return true;
    },
  );

  const malformedApi = await loadPreload(async () => ({
    ok: false,
    error: { message: "internal class and stack" },
  }));
  await assert.rejects(
    malformedApi.openHtml(),
    (error) => {
      assert.equal(error.code, "INVALID_PROJECT_RESPONSE");
      assert.equal(error.message, "本地文件服务返回了无效结果，请重试。");
      assert.doesNotMatch(error.message, /internal|class|stack/i);
      return true;
    },
  );
});
