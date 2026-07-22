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
  const ipcRenderer = {
    invoke,
    on() {},
    removeListener() {},
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

test("preload exposes the narrow generated-version activation operation", async () => {
  const calls = [];
  const api = await loadPreload(async (...args) => {
    calls.push(args);
    return success({
      sourcePath: "/Users/demo/PageRoot/项目记录/projects/project_demo/working/report-V1.1.html",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      previousSourcePath: "/Users/demo/report.html",
      versionId: "ver_0002",
    });
  });
  const payload = {
    previousSourcePath: "/Users/demo/report.html",
    nextSourcePath: "/Users/demo/PageRoot/项目记录/projects/project_demo/working/report-V1.1.html",
    expectedSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: "project_demo",
    versionId: "ver_0002",
  };

  assert.deepEqual(
    await api.activateGeneratedVersion(payload),
    {
      sourcePath: "/Users/demo/PageRoot/项目记录/projects/project_demo/working/report-V1.1.html",
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
      versionPath: "/Users/demo/PageRoot/项目记录/projects/project_demo/versions/ver_0002/files/index.html",
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
      versionPath: "/Users/demo/PageRoot/项目记录/projects/project_demo/versions/ver_0002/files/index.html",
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

test("preload exposes backend update status and the fixed project link", async () => {
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

  await updates.openProjectRepository();
  assert.deepEqual(calls[1], ["html-updates:open-repository"]);
  assert.deepEqual(Object.keys(updates).sort(), [
    "getStatus",
    "onStatus",
    "openProjectRepository",
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
