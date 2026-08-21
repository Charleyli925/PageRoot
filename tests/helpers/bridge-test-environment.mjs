import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const bridgeScript = join(productRoot, "scripts", "workspace-bridge.mjs");
const authHeader = "x-html-ai-bridge-token";

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("Bridge test port did not resolve to a loopback address");
  }
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

function diagnostics(session) {
  return [
    "Bridge stdout:",
    session.logs.stdout || "(empty)",
    "Bridge stderr:",
    session.logs.stderr || "(empty)",
  ].join("\n");
}

function bridgeError(message, session, cause) {
  const error = new Error(`${message}\n${diagnostics(session)}`, { cause });
  error.logs = session.logs;
  return error;
}

function withAuth(init = {}, token, includeAuth) {
  const headers = new Headers(init.headers);
  if (includeAuth && token && !headers.has(authHeader)) {
    headers.set(authHeader, token);
  }
  return { ...init, headers };
}

async function requestJsonForSession(
  session,
  pathname,
  init,
  { auth = true } = {},
) {
  let response;
  try {
    response = await fetch(
      `${session.baseUrl}${pathname}`,
      withAuth(init, session.authToken, auth),
    );
  } catch (error) {
    throw bridgeError(
      `Bridge request failed for ${String(init?.method || "GET")} ${pathname}`,
      session,
      error,
    );
  }

  const text = await response.text();
  let body = null;
  let jsonError = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      jsonError = error;
    }
  }
  return { response, body, text, jsonError, logs: session.logs };
}

function postJsonForSession(session, pathname, body, init, options) {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return requestJsonForSession(
    session,
    pathname,
    {
      ...init,
      method: init?.method || "POST",
      headers,
      body: JSON.stringify(body),
    },
    options,
  );
}

async function waitForChildExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveExit) => {
    const settled = () => {
      child.off("exit", settled);
      resolveExit();
    };
    child.once("exit", settled);
    if (child.exitCode !== null) settled();
  });
}

async function stopSession(session) {
  const { child } = session;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timedOut = await Promise.race([
    waitForChildExit(child).then(() => false),
    delay(2_000).then(() => true),
  ]);
  if (timedOut && child.exitCode === null) {
    child.kill("SIGKILL");
    await waitForChildExit(child);
  }
}

async function waitForHealth(session) {
  const deadline = Date.now() + 15_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (session.spawnError) {
      throw bridgeError("Bridge process failed to start", session, session.spawnError);
    }
    if (session.child.exitCode !== null) {
      throw bridgeError(
        `Bridge exited with ${session.child.exitCode}`,
        session,
      );
    }
    try {
      const health = await requestJsonForSession(session, "/health");
      if (health.response.status === 200 && health.body) return health.body;
      lastError = new Error(
        `health returned ${health.response.status}: ${health.text}`,
      );
    } catch (error) {
      lastError = error;
    }
    await delay(30);
  }
  throw bridgeError(
    `Bridge health timeout: ${lastError?.message || "unknown error"}`,
    session,
    lastError || undefined,
  );
}

function assertSourcePath(sources, name) {
  if (typeof name !== "string" || !name) {
    throw new TypeError("Bridge test source name must be a non-empty string");
  }
  const path = resolve(sources, name);
  const fromSources = relative(sources, path);
  if (
    !fromSources
    || fromSources.startsWith("..")
    || isAbsolute(fromSources)
  ) {
    throw new Error(`Bridge test source escapes its environment: ${name}`);
  }
  return path;
}

/**
 * Creates one fully isolated Bridge process environment for one Node test.
 * Sequential restarts inside that test are intentional; concurrent Bridge
 * processes and all state are otherwise scoped to this one temporary root.
 */
export async function createBridgeTestEnvironment(t, options = {}) {
  if (!t || typeof t.after !== "function") {
    throw new TypeError("createBridgeTestEnvironment requires a node:test context");
  }

  const root = await realpath(
    await mkdtemp(join(tmpdir(), options.prefix || "pageroot-bridge-test-")),
  );
  const workspace = join(root, options.workspaceRelativePath || "workspace");
  const sources = join(root, options.sourcesRelativePath || "sources");
  if (options.createWorkspace !== false) await mkdir(workspace, { recursive: true });
  await mkdir(sources, { recursive: true });

  const baseEnvironment = {
    ...(options.environment || {}),
    ...(options.extraEnvironment || {}),
  };
  let activeSession = null;
  let cleanupPromise = null;
  let disposed = false;

  const environment = {
    root,
    workspace,
    sources,
    get child() {
      return activeSession?.child || null;
    },
    get baseUrl() {
      return activeSession?.baseUrl || null;
    },
    get logs() {
      return activeSession?.logs || { stdout: "", stderr: "" };
    },
    async createSource(name, htmlOrBuffer) {
      const sourcePath = assertSourcePath(sources, name);
      await mkdir(dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, htmlOrBuffer);
      return sourcePath;
    },
    async start(extraEnvironment = {}) {
      if (disposed) throw new Error("Bridge test environment has already been cleaned up");
      if (
        activeSession?.child.exitCode === null
        && activeSession.child.signalCode === null
      ) {
        throw new Error("Bridge test environment already has a running Bridge process");
      }
      const {
        authToken: startAuthToken,
        bridgeScript: startBridgeScript,
        command: startCommand,
        commandArgs: startCommandArgs,
        cwd: startCwd,
        environment: explicitEnvironment,
        ...plainEnvironment
      } = extraEnvironment;
      const environmentOverrides = {
        ...baseEnvironment,
        ...plainEnvironment,
        ...(explicitEnvironment || {}),
      };
      const port = await reservePort();
      const logs = { stdout: "", stderr: "" };
      const authToken =
        startAuthToken
        ?? options.authToken
        ?? environmentOverrides.HTML_AI_BRIDGE_AUTH_TOKEN
        ?? "";
      const command = startCommand || options.command || process.execPath;
      const args =
        startCommandArgs
        || options.commandArgs
        || [startBridgeScript || options.bridgeScript || bridgeScript];
      const child = spawn(command, args, {
        cwd: startCwd || options.cwd || productRoot,
        env: {
          ...process.env,
          HTML_AI_WORKSPACE: workspace,
          HTML_AI_PROJECT_FILES_ROOT: join(root, "project-files"),
          HTML_AI_BRIDGE_PORT: String(port),
          ...environmentOverrides,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const session = {
        child,
        baseUrl: `http://127.0.0.1:${port}`,
        logs,
        authToken,
        spawnError: null,
      };
      activeSession = session;
      child.once("error", (error) => {
        session.spawnError = error;
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        logs.stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        logs.stderr += chunk;
      });
      await waitForHealth(session);
      return {
        child,
        baseUrl: session.baseUrl,
        logs,
        requestJson(pathname, init, requestOptions) {
          return requestJsonForSession(session, pathname, init, requestOptions);
        },
        postJson(pathname, body, init, requestOptions) {
          return postJsonForSession(
            session,
            pathname,
            body,
            init,
            requestOptions,
          );
        },
        stop() {
          return stopSession(session);
        },
      };
    },
    requestJson(pathname, init, requestOptions) {
      if (!activeSession) throw new Error("Bridge test environment has not started");
      return requestJsonForSession(activeSession, pathname, init, requestOptions);
    },
    postJson(pathname, body, init, requestOptions) {
      if (!activeSession) throw new Error("Bridge test environment has not started");
      return postJsonForSession(activeSession, pathname, body, init, requestOptions);
    },
    async ensureProject(sourcePath, requestOptions) {
      const preview = await environment.requestJson(
        `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
        undefined,
        requestOptions,
      );
      if (preview.response.status !== 200 || preview.body?.registered !== false) {
        return preview;
      }
      return environment.postJson(
        "/project/ensure",
        {
          sourcePath,
          expectedSourceSha256: preview.body.currentHtmlSha256,
        },
        undefined,
        requestOptions,
      );
    },
    async stop() {
      if (activeSession) await stopSession(activeSession);
    },
    async cleanup() {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        await environment.stop();
        await rm(root, { recursive: true, force: true });
        disposed = true;
      })();
      return cleanupPromise;
    },
  };

  t.after(() => environment.cleanup());
  return environment;
}
