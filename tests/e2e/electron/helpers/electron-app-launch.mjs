import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "@playwright/test";
import { _electron as electron } from "playwright";

import {
  caseSelector,
  productRoot,
} from "../../browser/pageroot-driver.mjs";
import {
  seedActiveDiskProject,
  seedDismissedFirstEditGuide,
} from "./electron-project-fixture.mjs";
import { stopPageRoot } from "./electron-safe-cleanup.mjs";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const DEFAULT_USER_DATA_PREFIX = "pageroot-native-e2e-";
const DEFAULT_MAIN_WINDOW_TIMEOUT = 15_000;
const MAX_DIAGNOSTIC_STREAM_CHUNKS = 40;
const MAX_DIAGNOSTIC_TEXT_LENGTH = 4_000;
const MAX_RENDERER_DIAGNOSTIC_EVENTS = 30;
const MAX_READINESS_SAMPLES = 24;
const MAX_REGISTRY_FILE_BYTES = 64 * 1024;
const DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT = 1_000;
const launchDiagnosticsByPage = new WeakMap();

function redactDiagnosticSecrets(value) {
  return String(value ?? "").replace(
    /(bridgeAuthToken=)[^&\s"'\\]+/giu,
    "$1[redacted]",
  );
}

function boundedDiagnosticText(value, limit = MAX_DIAGNOSTIC_TEXT_LENGTH) {
  const text = redactDiagnosticSecrets(value);
  return text.length <= limit ? text : `…${text.slice(-limit)}`;
}

function diagnosticError(error) {
  return boundedDiagnosticText(error instanceof Error ? error.message : String(error));
}

function diagnosticUrl(value) {
  const raw = String(value || "");
  try {
    const url = new URL(raw);
    if (url.searchParams.has("bridgeAuthToken")) {
      url.searchParams.set("bridgeAuthToken", "[redacted]");
    }
    return boundedDiagnosticText(url.toString());
  } catch {
    return boundedDiagnosticText(raw.replace(
      /([?&]bridgeAuthToken=)[^&]*/giu,
      "$1[redacted]",
    ));
  }
}

function appendDiagnosticValue(values, value, limit = MAX_DIAGNOSTIC_STREAM_CHUNKS) {
  if (values.length >= limit) return;
  values.push(boundedDiagnosticText(value));
}

function diagnosticEntries(values) {
  return Array.isArray(values) ? values.map((value) => boundedDiagnosticText(value)) : [];
}

function diagnosticStreamEntries(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  let remaining = MAX_DIAGNOSTIC_TEXT_LENGTH;
  const joined = values.slice(0, MAX_DIAGNOSTIC_STREAM_CHUNKS).map((value) => {
    if (remaining <= 0) return "";
    const chunk = String(value ?? "").slice(0, remaining);
    remaining -= chunk.length;
    return chunk;
  }).join("");
  return joined ? [boundedDiagnosticText(joined)] : [];
}

function processDiagnosticsSnapshot(diagnostics) {
  if (typeof diagnostics?.snapshot === "function") return diagnostics.snapshot();
  return {
    stdout: diagnosticStreamEntries(diagnostics?.stdout),
    stderr: diagnosticStreamEntries(diagnostics?.stderr),
  };
}

function diagnosticString(value, limit = MAX_DIAGNOSTIC_TEXT_LENGTH) {
  return value === null || value === undefined ? null : boundedDiagnosticText(value, limit);
}

function diagnosticTimeout(value = DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT;
  }
  return Math.min(Math.floor(timeout), DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT);
}

async function observeDiagnosticOperation(label, operation, timeout) {
  const operationResult = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ kind: "value", value }),
      (error) => ({ kind: "error", error }),
    );
  let timeoutId = null;
  const timedOut = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ kind: "timeout" }), timeout);
  });
  const outcome = await Promise.race([operationResult, timedOut]);
  if (timeoutId !== null) clearTimeout(timeoutId);
  if (outcome.kind === "timeout") {
    return { kind: "timeout", error: `${label} timed out after ${timeout}ms.` };
  }
  if (outcome.kind === "error") {
    return { kind: "error", error: diagnosticError(outcome.error) };
  }
  return outcome;
}

function summarizeDiagnosticValue(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return boundedDiagnosticText(value, 1_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value.slice(0, 12).map((item) => summarizeDiagnosticValue(item, depth + 1)),
    };
  }
  if (typeof value !== "object") return boundedDiagnosticText(value, 1_000);
  const entries = Object.entries(value);
  if (depth >= 3) {
    return { keys: entries.slice(0, 24).map(([key]) => key), keyCount: entries.length };
  }
  return Object.fromEntries(entries.slice(0, 24).map(([key, item]) => [
    key,
    summarizeDiagnosticValue(item, depth + 1),
  ]));
}

// Creates leftover pre-v4 project records solely to verify the v4
// incompatibility boundary: the Electron client must ignore them and import

function collectProcessDiagnostics(electronProcess) {
  const stdout = [];
  const stderr = [];
  const diagnostics = {
    snapshot: () => ({
      stdout: diagnosticStreamEntries(stdout),
      stderr: diagnosticStreamEntries(stderr),
    }),
  };
  const attach = (stream, lines) => {
    if (!stream?.on) return;
    stream.on("data", (chunk) => {
      if (lines.length >= MAX_DIAGNOSTIC_STREAM_CHUNKS) return;
      const collected = lines.reduce((length, value) => length + value.length, 0);
      if (collected >= MAX_DIAGNOSTIC_TEXT_LENGTH) return;
      lines.push(String(chunk ?? "").slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH - collected));
    });
  };
  attach(electronProcess?.stdout, stdout);
  attach(electronProcess?.stderr, stderr);
  return diagnostics;
}

function collectRendererDiagnostics(page) {
  const diagnostics = {
    console: [],
    pageErrors: [],
    lifecycle: [],
    requestFailures: [],
    navigation: [],
  };
  if (typeof page?.on !== "function") return diagnostics;
  page.on("console", (message) => {
    const type = typeof message?.type === "function" ? message.type() : "unknown";
    if (!["error", "warning"].includes(type)) return;
    appendDiagnosticValue(
      diagnostics.console,
      `${type}: ${typeof message?.text === "function" ? message.text() : ""}`,
      MAX_RENDERER_DIAGNOSTIC_EVENTS,
    );
  });
  page.on("pageerror", (error) => {
    appendDiagnosticValue(diagnostics.pageErrors, diagnosticError(error), MAX_RENDERER_DIAGNOSTIC_EVENTS);
  });
  page.on("crash", () => {
    appendDiagnosticValue(diagnostics.lifecycle, "page-crash", MAX_RENDERER_DIAGNOSTIC_EVENTS);
  });
  page.on("close", () => {
    appendDiagnosticValue(diagnostics.lifecycle, "page-close", MAX_RENDERER_DIAGNOSTIC_EVENTS);
  });
  page.on("requestfailed", (request) => {
    const failure = typeof request?.failure === "function" ? request.failure() : null;
    appendDiagnosticValue(
      diagnostics.requestFailures,
      `${diagnosticUrl(typeof request?.url === "function" ? request.url() : "unknown-url")}: ${failure?.errorText || "unknown"}`,
      MAX_RENDERER_DIAGNOSTIC_EVENTS,
    );
  });
  page.on("framenavigated", (frame) => {
    try {
      if (typeof page.mainFrame === "function" && frame !== page.mainFrame()) return;
      appendDiagnosticValue(
        diagnostics.navigation,
        diagnosticUrl(typeof frame?.url === "function" ? frame.url() : "unknown-url"),
        MAX_RENDERER_DIAGNOSTIC_EVENTS,
      );
    } catch (error) {
      appendDiagnosticValue(
        diagnostics.navigation,
        `navigation-observation-failed: ${diagnosticError(error)}`,
        MAX_RENDERER_DIAGNOSTIC_EVENTS,
      );
    }
  });
  return diagnostics;
}

function diagnosticFileSnapshot(filePath) {
  try {
    if (!existsSync(filePath)) return { exists: false };
    const stats = statSync(filePath);
    if (!stats.isFile()) return { exists: true, kind: "not-file" };
    if (stats.size > MAX_REGISTRY_FILE_BYTES) {
      return { exists: true, bytes: stats.size, omitted: "too-large" };
    }
    const raw = readFileSync(filePath, "utf8");
    return {
      exists: true,
      bytes: stats.size,
      value: summarizeDiagnosticValue(JSON.parse(raw)),
    };
  } catch (error) {
    return { exists: true, error: diagnosticError(error) };
  }
}

function isolatedRegistrySnapshot({ isolatedUserData, workspace, projectFilesRoot }) {
  if (!isolatedUserData) return null;
  const registryRoot = projectFilesRoot || path.join(isolatedUserData, "project-files");
  let projects;
  try {
    projects = existsSync(registryRoot)
      ? readdirSync(registryRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .slice(0, 20)
        .map((entry) => ({
          name: boundedDiagnosticText(entry.name, 1_000),
          project: diagnosticFileSnapshot(
            path.join(registryRoot, entry.name, ".pageroot", "project.json"),
          ),
          manifest: diagnosticFileSnapshot(
            path.join(registryRoot, entry.name, ".pageroot", "manifest.json"),
          ),
        }))
      : [];
  } catch (error) {
    projects = [{ error: diagnosticError(error) }];
  }
  return {
    path: boundedDiagnosticText(isolatedUserData, 1_000),
    activeDiskProject: diagnosticFileSnapshot(path.join(isolatedUserData, "html-projects.json")),
    legacyWorkspaceRegistry: diagnosticFileSnapshot(
      path.join(workspace || path.join(isolatedUserData, "workspace"), "project-registry.json"),
    ),
    projectFiles: {
      path: boundedDiagnosticText(registryRoot, 1_000),
      exists: existsSync(registryRoot),
      projects,
    },
  };
}

function readinessSample(samples, value) {
  const state = boundedDiagnosticText(value, 1_000);
  const previous = samples.at(-1)?.state;
  if (previous === state || samples.length >= MAX_READINESS_SAMPLES) return;
  samples.push({ at: new Date().toISOString(), state });
}

function rendererDocumentSnapshot(value) {
  const documentSnapshot = value && typeof value === "object" ? value : {};
  const workbench = documentSnapshot.workbench && typeof documentSnapshot.workbench === "object"
    ? documentSnapshot.workbench
    : {};
  const visibleFailure = documentSnapshot.visibleFailure
    && typeof documentSnapshot.visibleFailure === "object"
    ? documentSnapshot.visibleFailure
    : null;
  const root = documentSnapshot.root && typeof documentSnapshot.root === "object"
    ? documentSnapshot.root
    : {};
  return {
    url: diagnosticUrl(documentSnapshot.url),
    readyState: diagnosticString(documentSnapshot.readyState, 120),
    visibilityState: diagnosticString(documentSnapshot.visibilityState, 120),
    title: diagnosticString(documentSnapshot.title, 1_000),
    workbench: {
      exists: Boolean(workbench.exists),
      projectState: diagnosticString(workbench.projectState, 1_000),
    },
    hydrationStage: diagnosticString(documentSnapshot.hydrationStage, 1_000),
    visibleFailure: visibleFailure ? {
      text: diagnosticString(visibleFailure.text, 1_000),
      visible: Boolean(visibleFailure.visible),
    } : null,
    root: {
      exists: Boolean(root.exists),
      childElementCount: Number.isFinite(root.childElementCount)
        ? root.childElementCount
        : 0,
      childTags: Array.isArray(root.childTags)
        ? root.childTags.slice(0, 8).map((tag) => boundedDiagnosticText(tag, 120))
        : [],
    },
    projectApiPresent: Boolean(documentSnapshot.projectApiPresent),
  };
}

async function rendererReadinessSnapshot(page, { timeout }) {
  const pageUrl = (() => {
    try {
      return typeof page?.url === "function" ? page.url() : null;
    } catch (error) {
      return `unavailable:${diagnosticError(error)}`;
    }
  })();
  if (typeof page?.evaluate !== "function") {
    return { pageUrl: diagnosticUrl(pageUrl), documentError: "renderer-page-unavailable" };
  }
  const outcome = await observeDiagnosticOperation(
    "renderer readiness snapshot",
    () => page.evaluate(() => {
      const workbench = document.querySelector("main.workbench");
      const failure = document.querySelector('[aria-label="项目读取失败"]');
      const root = document.getElementById("root");
      return {
        url: window.location.href,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        title: document.title,
        workbench: {
          exists: Boolean(workbench),
          projectState: workbench?.getAttribute("data-project-state") || null,
        },
        hydrationStage: window.__PAGEROOT_HYDRATION_STAGE__ || null,
        visibleFailure: failure ? {
          text: failure.textContent || "",
          visible: Boolean(failure.getClientRects().length),
        } : null,
        root: {
          exists: Boolean(root),
          childElementCount: root?.childElementCount || 0,
          childTags: Array.from(root?.children || [])
            .slice(0, 8)
            .map((element) => element.tagName.toLowerCase()),
        },
        projectApiPresent: Boolean(window.htmlAIProjects),
      };
    }),
    timeout,
  );
  if (outcome.kind !== "value") {
    return { pageUrl: diagnosticUrl(pageUrl), documentError: outcome.error };
  }
  return {
    pageUrl: diagnosticUrl(pageUrl),
    document: rendererDocumentSnapshot(outcome.value),
  };
}

async function nativeWindowSnapshot(electronApp, { timeout }) {
  if (!electronApp || typeof electronApp.evaluate !== "function") return null;
  const outcome = await observeDiagnosticOperation(
    "native BrowserWindow snapshot",
    () => electronApp.evaluate(({ BrowserWindow }) => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      return BrowserWindow.getAllWindows().map((window) => {
        const contents = window.webContents;
        return {
          id: window.id,
          focused: focusedWindow?.id === window.id,
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          destroyed: window.isDestroyed(),
          url: contents.getURL(),
          loading: contents.isLoading(),
          crashed: typeof contents.isCrashed === "function" ? contents.isCrashed() : null,
          processId: typeof contents.getOSProcessId === "function"
            ? contents.getOSProcessId()
            : null,
        };
      });
    }),
    timeout,
  );
  if (outcome.kind !== "value") return { error: outcome.error };
  return Array.isArray(outcome.value)
    ? outcome.value.map((window) => ({ ...window, url: diagnosticUrl(window.url) }))
    : outcome.value;
}

async function waitForFirstWindow(electronApp, { timeout }) {
  const outcome = await observeDiagnosticOperation(
    "PageRoot first window",
    () => electronApp.firstWindow(),
    timeout,
  );
  if (outcome.kind === "value") return outcome.value;
  throw new Error(outcome.error);
}

function safeRendererMount(value) {
  return value && typeof value === "object" ? summarizeDiagnosticValue(value) : null;
}

/**
 * Produces bounded, failure-only evidence for a project-hydration timeout.
 * It intentionally observes test-owned paths and the already-running Electron
 * process only; it never retries, reloads, or changes application state.
 */
export async function collectProjectReadinessDiagnostics(page, context = null) {
  const launch = context || (page && launchDiagnosticsByPage.get(page)) || {};
  const timeout = diagnosticTimeout(launch.diagnosticTimeout);
  const [renderer, nativeWindows] = await Promise.all([
    rendererReadinessSnapshot(page, { timeout }),
    nativeWindowSnapshot(launch.electronApp, { timeout }),
  ]);
  return {
    renderer,
    nativeWindows,
    launch: {
      mainRendererUrl: launch.mainRendererUrl ? diagnosticUrl(launch.mainRendererUrl) : null,
      rendererMount: safeRendererMount(launch.rendererMount),
    },
    rendererEvents: {
      console: diagnosticEntries(launch.rendererDiagnostics?.console),
      pageErrors: diagnosticEntries(launch.rendererDiagnostics?.pageErrors),
      lifecycle: diagnosticEntries(launch.rendererDiagnostics?.lifecycle),
      requestFailures: diagnosticEntries(launch.rendererDiagnostics?.requestFailures),
      navigation: diagnosticEntries(launch.rendererDiagnostics?.navigation),
    },
    mainProcess: {
      ...processDiagnosticsSnapshot(launch.processDiagnostics),
    },
    isolatedRegistry: isolatedRegistrySnapshot(launch),
  };
}

async function projectReadinessTimeout(page, cause, readinessSamples) {
  const diagnostics = await collectProjectReadinessDiagnostics(page);
  const original = diagnosticError(cause);
  return new Error([
    "PageRoot project readiness did not settle.",
    original,
    "Project readiness samples:",
    JSON.stringify(readinessSamples, null, 2),
    "Project readiness diagnostics:",
    JSON.stringify(diagnostics, null, 2),
  ].join("\n\n"));
}

async function projectLaunchFailure(page, cause, stage, context) {
  const diagnostics = await collectProjectReadinessDiagnostics(page, context);
  const original = diagnosticError(cause);
  return new Error([
    `PageRoot launch failed while ${stage}.`,
    original,
    "Launch diagnostics:",
    JSON.stringify(diagnostics, null, 2),
  ].join("\n\n"));
}

export async function waitForMainBrowserWindow(
  electronApp,
  rendererUrl,
  { timeout = DEFAULT_MAIN_WINDOW_TIMEOUT } = {},
) {
  let nativeWindow = null;
  await expect.poll(async () => {
    nativeWindow = await electronApp.evaluate(({ BrowserWindow }, expectedRendererUrl) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => (
        !candidate.isDestroyed()
        && candidate.webContents.getURL() === expectedRendererUrl
      ));
      if (!window) return null;
      window.webContents.setBackgroundThrottling(false);
      return {
        focused: window.isFocused(),
        visible: window.isVisible(),
      };
    }, rendererUrl);
    return nativeWindow !== null;
  }, {
    timeout,
    message: "PageRoot main BrowserWindow did not become available during launch.",
  }).toBe(true);
  return nativeWindow;
}

const DEFAULT_RENDERER_MOUNT_TIMEOUT = 20_000;
const RENDERER_MOUNT_POLL_MS = 100;
const READINESS_POLL_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Which documents of a page were seen carrying a mounted workbench, and the
// renderer faults that page reported. Keyed per page so a packaged-app page
// that never went through launchPageRoot degrades to "no evidence" instead of
// borrowing another page's history.
const rendererMountHistory = new WeakMap();
const rendererFaultLogs = new WeakMap();

export function recordRendererFaultLog(page, sink) {
  rendererFaultLogs.set(page, sink);
}

export function rendererFaultLog(page) {
  return rendererFaultLogs.get(page) || [];
}

export function observedRendererMount(page, documentId) {
  if (!documentId) return false;
  return (rendererMountHistory.get(page) || []).includes(documentId);
}

// `data-project-state` is always one of failed/hydrating/ready/unbound while
// main.workbench renders, so a null state means the element is absent rather
// than undecided. Telling "never mounted" apart from "mounted then vanished"
// needs a per-document identity, so stamp one on first observation: a reload
// or navigation produces a new document and therefore a new id.
export async function rendererProbe(page, {
  timeout = DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT,
} = {}) {
  const outcome = await observeDiagnosticOperation(
    "renderer readiness probe",
    () => page.evaluate(() => {
      const globals = window;
      if (!globals.__PAGEROOT_E2E_DOCUMENT_ID__) {
        globals.__PAGEROOT_E2E_DOCUMENT_ID__ = `doc-${Date.now()}-${
          Math.random().toString(36).slice(2)
        }`;
      }
      const workbench = document.querySelector("main.workbench");
      const root = document.getElementById("root");
      return {
        documentId: globals.__PAGEROOT_E2E_DOCUMENT_ID__,
        mounted: Boolean(workbench),
        projectState: workbench?.getAttribute("data-project-state") || null,
        hydrationStage: globals.__PAGEROOT_HYDRATION_STAGE__ || null,
        rootChildren: root ? root.childElementCount : -1,
      };
    }),
    timeout,
  );
  if (outcome.kind !== "value") return null;
  const snapshot = outcome.value;
  if (snapshot?.mounted && snapshot.documentId) {
    const seen = rendererMountHistory.get(page) || [];
    if (!seen.includes(snapshot.documentId)) {
      rendererMountHistory.set(page, [...seen, snapshot.documentId]);
    }
  }
  return snapshot;
}

// A first mount that has not happened yet stays "pending", and the reload the
// launch path already performs replaces the document legitimately. Only a live
// document that drops a workbench it had mounted is a renderer fault.
export function classifyRendererMount({
  mounted,
  mountObservedForDocument,
  documentReplaced,
}) {
  if (mounted) return "mounted";
  if (documentReplaced) return "document-replaced";
  return mountObservedForDocument ? "torn-down" : "pending";
}

export function describeRendererReadiness(reason, snapshot, faults, extra = {}) {
  const captured = faults || [];
  return [
    reason,
    `- project state: ${snapshot?.projectState ?? "absent"}`,
    `- hydration stage: ${snapshot?.hydrationStage ?? "unmarked"}`,
    `- #root child elements: ${
      snapshot && typeof snapshot.rootChildren === "number" ? snapshot.rootChildren : "unknown"
    }`,
    `- document: ${extra.documentNote || snapshot?.documentId || "unknown"}`,
    ...(extra.visibleFailure ? [`- visible failure: ${extra.visibleFailure}`] : []),
    `- renderer faults: ${captured.length ? `${captured.length} captured` : "none captured"}`,
    ...captured.map((fault) => `    ${fault}`),
  ].join("\n");
}

export async function pageHasRendererMount(page, {
  timeout = DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT,
} = {}) {
  const snapshot = await rendererProbe(page, { timeout });
  return Boolean(snapshot?.mounted);
}

export async function ensureRendererMounted(page, {
  timeout = DEFAULT_RENDERER_MOUNT_TIMEOUT,
} = {}) {
  const waitUntilMounted = async () => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      if (await pageHasRendererMount(page, {
        timeout: Math.min(DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT, remaining),
      })) return true;
      await sleep(RENDERER_MOUNT_POLL_MS);
    }
    return pageHasRendererMount(page, { timeout: 1 });
  };

  if (await waitUntilMounted()) return { reloaded: false };
  throw new Error("PageRoot renderer did not mount during initial launch.");
}

export async function launchPageRoot({
  activeSourcePath = null,
  recentSourcePaths = activeSourcePath ? [activeSourcePath] : [],
  isolatedUserData: existingUserData = null,
  injectedEnv = {},
  userDataPrefix = DEFAULT_USER_DATA_PREFIX,
  firstEditGuide = false,
  electronLauncher = (options) => electron.launch(options),
  shutdown = stopPageRoot,
  firstWindowTimeout = DEFAULT_MAIN_WINDOW_TIMEOUT,
  diagnosticTimeout: diagnosticOperationTimeout = DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT,
} = {}) {
  const isolatedUserData = existingUserData || mkdtempSync(
    path.join(tmpdir(), userDataPrefix),
  );
  mkdirSync(isolatedUserData, { recursive: true });
  const workspace = path.join(isolatedUserData, "workspace");
  if (!firstEditGuide) seedDismissedFirstEditGuide(isolatedUserData);
  if (activeSourcePath) {
    seedActiveDiskProject(isolatedUserData, activeSourcePath, recentSourcePaths);
  }
  const electronApp = await electronLauncher({
    executablePath: electronExecutable,
    args: [path.join(productRoot, "desktop/main.mjs")],
    cwd: productRoot,
    env: {
      ...process.env,
          PAGEROOT_E2E: "1",
          ...(firstEditGuide ? { PAGEROOT_E2E_FIRST_EDIT_GUIDE: "1" } : {}),
          PAGEROOT_E2E_USER_DATA_DIR: isolatedUserData,
          HTML_AI_WORKSPACE: workspace,
          // New project-file imports deliberately live outside the legacy
          // workspace. Keep that user-owned root inside this isolated E2E
          // profile so tests exercise the real import handoff without
          // creating Finder projects in the developer's Documents folder.
          HTML_AI_PROJECT_FILES_ROOT: path.join(isolatedUserData, "project-files"),
          ...injectedEnv,
    },
  });
  const diagnostics = collectProcessDiagnostics(electronApp.process());
  const projectFilesRoot = path.join(isolatedUserData, "project-files");
  const launchDiagnostics = {
    electronApp,
    isolatedUserData,
    workspace,
    projectFilesRoot,
    mainRendererUrl: null,
    processDiagnostics: diagnostics,
    rendererDiagnostics: collectRendererDiagnostics(null),
    rendererMount: null,
    diagnosticTimeout: diagnosticOperationTimeout,
  };
  let page = null;
  let nativeWindow;
  try {
    page = await waitForFirstWindow(electronApp, { timeout: firstWindowTimeout });
    // A fatal render error can unmount the React root while leaving a live
    // document. Keep a page-local fault log so readiness can attribute that
    // failure instead of reducing it to a generic timeout.
    const rendererFaults = [];
    page.on("pageerror", (error) => {
      appendDiagnosticValue(rendererFaults, `pageerror: ${diagnosticError(error)}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        appendDiagnosticValue(rendererFaults, `console.error: ${message.text()}`);
      }
    });
    recordRendererFaultLog(page, rendererFaults);
    launchDiagnostics.rendererDiagnostics = collectRendererDiagnostics(page);
    launchDiagnosticsByPage.set(page, launchDiagnostics);
    await page.waitForLoadState("domcontentloaded");
    const mainRendererUrl = page.url();
    launchDiagnostics.mainRendererUrl = mainRendererUrl;
    nativeWindow = await waitForMainBrowserWindow(electronApp, mainRendererUrl);
    await page.waitForFunction(() => document.visibilityState === "visible");
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    launchDiagnostics.rendererMount = await ensureRendererMounted(page);
  } catch (cause) {
    const failure = await projectLaunchFailure(
      page,
      cause,
      "registering and mounting the main renderer",
      launchDiagnostics,
    );
    try {
      await shutdown(electronApp, isolatedUserData, { cleanup: false });
    } catch (shutdownError) {
      failure.message = `${failure.message}\n\nFailed-launch cleanup: ${diagnosticError(shutdownError)}`;
    }
    throw failure;
  }
  const foreground = (
    injectedEnv.PAGEROOT_E2E_FOREGROUND
    ?? process.env.PAGEROOT_E2E_FOREGROUND
  ) === "1";
  expect(nativeWindow.visible).toBe(foreground);
  if (!foreground) expect(nativeWindow.focused).toBe(false);
  return {
    electronApp,
    page,
    isolatedUserData,
    workspace,
    diagnostics: {
      ...processDiagnosticsSnapshot(diagnostics),
      userDataPath: isolatedUserData,
      workspacePath: workspace,
      projectFilesRoot,
    },
  };
}

export async function sendToMainRenderer(electronApp, page, channel, payload) {
  const mainRendererUrl = page?.url();
  if (!mainRendererUrl) {
    throw new Error("PageRoot main renderer URL is unavailable for renderer IPC.");
  }
  const delivered = await electronApp.evaluate(
    ({ BrowserWindow }, { rendererUrl, messageChannel, messagePayload }) => {
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL() === rendererUrl
      ));
      if (!mainWindow) return false;
      mainWindow.webContents.send(messageChannel, messagePayload);
      return true;
    },
    {
      rendererUrl: mainRendererUrl,
      messageChannel: channel,
      messagePayload: payload,
    },
  );
  if (!delivered) {
    throw new Error("PageRoot main BrowserWindow was unavailable for renderer IPC.");
  }
}

export async function waitForProjectReady(page, {
  timeout = 60_000,
  includeFailureDetail = true,
} = {}) {
  const importButton = page.getByRole("button", { name: "导入并打开" });
  const continueButton = page.getByRole("button", { name: "打开之前的项目" });
  const readinessSamples = [];
  const confirmationKind = async () => {
    if (await importButton.isVisible().catch(() => false)) return "import";
    if (await continueButton.isVisible().catch(() => false)) return "continue";
    return "";
  };
  const visibleFailure = async (snapshot) => (
    includeFailureDetail && snapshot?.projectState === "failed"
      ? await page.locator('[aria-label="项目读取失败"]').textContent().catch(() => "")
      : ""
  );

  let currentDocumentId = "";

  // Settle on a ready project, or on the confirmation the startup path is
  // waiting for. A workbench that disappears inside one live document fails
  // immediately instead of being hidden behind the full hydration timeout.
  const settleReady = async ({ acceptConfirmation }) => {
    const deadline = Date.now() + timeout;
    let snapshot = null;
    for (;;) {
      const confirmation = await confirmationKind();
      if (confirmation) {
        readinessSample(readinessSamples, `confirm:${confirmation}`);
        if (acceptConfirmation) return confirmation;
      } else {
        snapshot = await rendererProbe(page, {
          timeout: Math.min(DEFAULT_DIAGNOSTIC_OPERATION_TIMEOUT, Math.max(1, deadline - Date.now())),
        });
        if (snapshot) {
          const documentReplaced = Boolean(currentDocumentId)
            && currentDocumentId !== snapshot.documentId;
          currentDocumentId = snapshot.documentId;
          const state = `${snapshot.projectState || "missing"}:${snapshot.hydrationStage || "unmarked"}`;
          readinessSample(readinessSamples, state);
          if (snapshot.projectState === "ready") return "";
          const classification = classifyRendererMount({
            mounted: snapshot.mounted,
            mountObservedForDocument: observedRendererMount(page, snapshot.documentId),
            documentReplaced,
          });
          if (classification === "torn-down") {
            throw new Error(describeRendererReadiness(
              "PageRoot renderer unmounted the workbench it had already mounted. "
              + "A live document must never drop main.workbench.",
              snapshot,
              rendererFaultLog(page),
              { documentNote: `unchanged (${snapshot.documentId})` },
            ));
          }
        } else {
          readinessSample(readinessSamples, "transient:renderer-probe:no-detail");
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(describeRendererReadiness(
          `PageRoot project did not become ready within ${timeout}ms.`,
          snapshot,
          rendererFaultLog(page),
          { visibleFailure: await visibleFailure(snapshot) },
        ));
      }
      await sleep(READINESS_POLL_MS);
    }
  };

  let pendingConfirmation = "";
  try {
    pendingConfirmation = await settleReady({ acceptConfirmation: true });
  } catch (cause) {
    throw await projectReadinessTimeout(page, cause, readinessSamples);
  }

  // Last-active external HTML can overlay confirmation after welcome is already ready.
  if (!pendingConfirmation) {
    try {
      await importButton.or(continueButton).waitFor({ state: "visible", timeout: 1_500 });
      pendingConfirmation = await confirmationKind();
    } catch {
      pendingConfirmation = "";
    }
  }

  if (pendingConfirmation === "import" || pendingConfirmation === "continue") {
    const button = pendingConfirmation === "import" ? importButton : continueButton;
    if (pendingConfirmation === "import") {
      const importDialog = page.locator(
        'section[role="dialog"][data-classification="new-external"]',
      );
      await expect(importDialog).toBeVisible();
      await expect(importDialog).toContainText("复制本文件并保存为");
      await expect(importDialog).toContainText(
        "成功导入后，同意将原文件移至废纸篓。",
      );
      await expect(importDialog.getByRole("checkbox"))
        .not.toBeChecked();
      await expect(importDialog.getByRole("button", { name: /^点击打开 /u }))
        .toBeVisible();
    }
    await button.focus();
    await button.click();
    try {
      await settleReady({ acceptConfirmation: false });
    } catch (cause) {
      throw await projectReadinessTimeout(page, cause, readinessSamples);
    }
  }
}

export async function loadedDiskFrame(
  page,
  sourcePath,
  {
    editable = true,
    expectedCase = "list-item",
    timeout = 60_000,
    includeEditor = false,
  } = {},
) {
  const canonicalSourcePath = realpathSync(sourcePath);
  await waitForProjectReady(page, { timeout });
  const extension = path.extname(canonicalSourcePath);
  const expectedWorkingCopyName = `${path.basename(canonicalSourcePath, extension)}-V1${extension}`;
  let activeSourcePath = "";
  await expect.poll(
    async () => {
      activeSourcePath = (
        await page.evaluate(() => window.htmlAIProjects?.getActiveProject())
      )?.sourcePath || "";
      if (!activeSourcePath) return "";
      const canonicalActiveSourcePath = realpathSync(activeSourcePath);
      return canonicalActiveSourcePath === canonicalSourcePath
        || path.basename(canonicalActiveSourcePath) === expectedWorkingCopyName
        ? canonicalActiveSourcePath
        : "";
    },
    { timeout: Math.min(timeout, 20_000) },
  ).not.toBe("");
  const canonicalActiveSourcePath = realpathSync(activeSourcePath);
  if (canonicalActiveSourcePath !== canonicalSourcePath) {
    // The desktop v4 opening boundary immediately imports every external HTML
    // into its own V1 Working Copy. Keep fixture callers honest about that
    // transition instead of preserving the retired external-preview contract.
    expect(path.basename(canonicalActiveSourcePath)).toBe(expectedWorkingCopyName);
  }
  await expect(page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "项目", exact: true }))
    .toBeEnabled({ timeout });
  if (editable) {
    const globalCommentButton = page.locator('aside[aria-label="本轮评论"]')
      .getByRole("button", { name: "全局评论", exact: true });
    await expect(globalCommentButton).toBeVisible({ timeout });
    await expect(globalCommentButton).toBeEnabled({ timeout });
  }
  await expect(page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  await editor.waitFor({ state: "visible", timeout });
  await expect(editor).toHaveAttribute("data-render-verified", "true", { timeout });
  const iframe = editor.locator('iframe[title*="HTML"]').first();
  await iframe.waitFor({ state: "attached", timeout });
  let frame = null;
  await expect.poll(async () => {
    try {
      const iframeHandle = await iframe.elementHandle();
      const candidate = await iframeHandle?.contentFrame() || null;
      if (!candidate) return false;
      if (await candidate.locator(caseSelector(expectedCase)).count() !== 1) {
        return false;
      }
      frame = candidate;
      return true;
    } catch (error) {
      if (/Frame was detached|Execution context was destroyed/u.test(String(error))) {
        return false;
      }
      throw error;
    }
  }, { timeout }).toBe(true);
  if (!frame) throw new Error("PageRoot did not expose the Electron edit frame.");
  return includeEditor ? { editor, frame, sourcePath: canonicalActiveSourcePath } : frame;
}
