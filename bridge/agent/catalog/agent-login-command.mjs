import { spawn } from "node:child_process";

import { terminateManagedProcess } from "../hosts/execution-host.mjs";
import { agentProviderError } from "../providers/agent-provider-contract.mjs";
import { extractAgentLoginUrl } from "../../../shared/agent-login-url.mjs";

const DEFAULT_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const AUTH_WAIT_INTERVAL_MS = 1_000;

function fail(code, message, options) {
  throw agentProviderError(code, message, options);
}

export async function runOfficialAgentLogin({
  executable,
  args = ["login"],
  env,
  providerId,
  signal,
  onOutput,
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
  processGroup = true,
} = {}) {
  if (typeof executable !== "string" || !executable) {
    fail("AGENT_LOGIN_UNSUPPORTED", "This Agent cannot start an official login.", { status: 409 });
  }
  if (signal?.aborted) {
    fail("AGENT_LOGIN_CANCELLED", "登录已取消。", { status: 409 });
  }

  const isolatedProcessGroup = processGroup !== false && process.platform !== "win32";
  const child = spawn(executable, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: isolatedProcessGroup,
  });
  let output = "";
  let loginUrl = null;
  const append = (chunk) => {
    output = `${output}${String(chunk || "")}`.slice(-32_768);
    const nextUrl = extractAgentLoginUrl(output, { providerId });
    if (nextUrl && nextUrl !== loginUrl) {
      loginUrl = nextUrl;
      onOutput?.({ loginUrl, output });
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  let timeoutHandle = null;
  let processCleaned = false;
  let failure = null;
  const stopChild = async () => {
    processCleaned = await terminateManagedProcess(child, { processGroup: isolatedProcessGroup });
    return processCleaned;
  };
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        signal?.removeEventListener?.("abort", onAbort);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => {
        void stopChild();
        finish(agentProviderError("AGENT_LOGIN_CANCELLED", "登录已取消。", { status: 409 }));
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          void stopChild();
          finish(agentProviderError("AGENT_LOGIN_EXPIRED", "登录等待已超时。", { status: 408 }));
        }, timeoutMs);
      }
      child.once("error", (cause) => {
        finish(agentProviderError(
          "AGENT_LOGIN_FAILED",
          "官方登录没有启动。",
          { status: 503, cause },
        ));
      });
      child.once("exit", (code, exitSignal) => {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        if (code === 0) {
          finish();
          return;
        }
        finish(agentProviderError(
          "AGENT_LOGIN_FAILED",
          "官方登录没有完成。",
          { status: 401, details: { code, signal: exitSignal || null } },
        ));
      });
    });
  } catch (cause) {
    failure = cause;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!processCleaned) {
      processCleaned = await terminateManagedProcess(child, {
        processGroup: isolatedProcessGroup,
      }).catch(() => false);
    }
  }

  if (failure) {
    if (failure?.code === "AGENT_LOGIN_CANCELLED" && !processCleaned) {
      fail("AGENT_LOGIN_CANCEL_FAILED", "无法确认登录进程已退出。", { status: 503 });
    }
    throw failure;
  }

  return Object.freeze({
    output,
    loginUrl,
    processExited: processCleaned,
  });
}

export async function runOfficialAgentLogout({
  executable,
  args = ["logout"],
  env,
  providerId,
  signal,
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
  processGroup = true,
} = {}) {
  return runOfficialAgentLogin({
    executable,
    args,
    env,
    providerId,
    signal,
    timeoutMs,
    processGroup,
  });
}

export async function waitForAgentAuthentication(inspect, {
  signal,
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
  intervalMs = AUTH_WAIT_INTERVAL_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof inspect !== "function") {
    fail("AGENT_LOGIN_UNSUPPORTED", "This Agent cannot verify an official login.", { status: 409 });
  }
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    if (signal?.aborted) fail("AGENT_LOGIN_CANCELLED", "登录已取消。", { status: 409 });
    try {
      const result = await inspect();
      if (result?.facts?.authentication === "ready" || result?.readiness === "ready") {
        return result;
      }
    } catch (cause) {
      const code = String(cause?.code || "");
      if (!/AUTH_REQUIRED|AUTH_UNVERIFIED/u.test(code)) throw cause;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });
  }
  fail("AGENT_LOGIN_EXPIRED", "登录等待已超时。", { status: 408 });
}
