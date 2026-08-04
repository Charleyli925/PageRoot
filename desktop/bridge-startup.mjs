const MAX_DIAGNOSTIC_CHARACTERS = 16_384;

function appendBounded(current, chunk) {
  const combined = `${current}${chunk?.toString?.() ?? String(chunk ?? "")}`;
  return combined.length <= MAX_DIAGNOSTIC_CHARACTERS
    ? combined
    : combined.slice(-MAX_DIAGNOSTIC_CHARACTERS);
}

function diagnosticSuffix(stderr) {
  const detail = stderr.trim();
  return detail ? `\n${detail}` : "";
}

export class BridgeExitedBeforeReadyError extends Error {
  constructor(exitCode, stderr = "") {
    const displayedCode = Number.isInteger(exitCode) ? exitCode : "未知";
    super(
      `本地工作区服务在准备完成前意外退出（${displayedCode}）。`
      + diagnosticSuffix(stderr),
    );
    this.name = "BridgeExitedBeforeReadyError";
    this.code = "BRIDGE_EXITED_BEFORE_READY";
    this.exitCode = Number.isInteger(exitCode) ? exitCode : null;
  }
}

export class BridgeProcessStartupError extends Error {
  constructor(report, stderr = "") {
    const detail = typeof report === "string" && report.trim()
      ? report.trim()
      : "无法启动本地工作区服务。";
    super(`${detail}${diagnosticSuffix(stderr)}`);
    this.name = "BridgeProcessStartupError";
    this.code = "BRIDGE_PROCESS_ERROR";
  }
}

export class BridgeReadyPortMismatchError extends Error {
  constructor(expectedPort, actualPort, stderr = "") {
    super(
      "本地工作区服务返回了无效的启动端口。"
      + diagnosticSuffix(stderr),
    );
    this.name = "BridgeReadyPortMismatchError";
    this.code = "BRIDGE_READY_PORT_MISMATCH";
    this.expectedPort = expectedPort;
    this.actualPort = actualPort;
  }
}

export function waitForBridgeReady(
  child,
  {
    expectedPort,
    slowAfterMs,
    onStillStarting = () => {},
  },
) {
  if (!child || typeof child.once !== "function") {
    throw new TypeError("必须提供可监听生命周期的本地工作区服务进程。");
  }
  if (!child.stdout || typeof child.stdout.on !== "function") {
    throw new TypeError("本地工作区服务必须提供可读取的标准输出。");
  }
  if (!Number.isSafeInteger(expectedPort) || expectedPort <= 0 || expectedPort > 65_535) {
    throw new TypeError("Bridge 启动端口必须是有效的 TCP 端口。");
  }
  if (!Number.isSafeInteger(slowAfterMs) || slowAfterMs <= 0) {
    throw new TypeError("Bridge 启动观察时间必须是正整数。");
  }
  if (typeof onStillStarting !== "function") {
    throw new TypeError("Bridge 延迟启动回调必须是函数。");
  }

  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let wasDelayed = false;
    let slowTimer;

    const cleanup = () => {
      clearTimeout(slowTimer);
      child.stdout.removeListener?.("data", handleStdout);
      child.stderr?.removeListener?.("data", handleStderr);
      child.removeListener?.("exit", handleExit);
      child.removeListener?.("error", handleError);
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const handleStdout = (chunk) => {
      stdoutBuffer = appendBounded(stdoutBuffer, chunk);
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message?.type !== "ready") continue;
        if (message.port !== expectedPort) {
          finish(
            reject,
            new BridgeReadyPortMismatchError(expectedPort, message.port, stderr),
          );
          return;
        }
        finish(resolve, Object.freeze({ port: expectedPort, wasDelayed }));
        return;
      }
    };
    const handleStderr = (chunk) => {
      stderr = appendBounded(stderr, chunk);
    };
    const handleExit = (exitCode) => {
      finish(reject, new BridgeExitedBeforeReadyError(exitCode, stderr));
    };
    const handleError = (_type, _location, report) => {
      finish(reject, new BridgeProcessStartupError(report, stderr));
    };

    slowTimer = setTimeout(() => {
      if (settled) return;
      wasDelayed = true;
      try {
        onStillStarting(Object.freeze({ expectedPort }));
      } catch {
        // Diagnostics must never turn a live startup operation into a failure.
      }
    }, slowAfterMs);
    slowTimer.unref?.();
    child.stderr?.on?.("data", handleStderr);
    child.once("exit", handleExit);
    child.once("error", handleError);
    // Attach stdout last: a buffered Readable may emit immediately when it
    // enters flowing mode, and cleanup must already know every other listener.
    child.stdout.on("data", handleStdout);
  });
}
