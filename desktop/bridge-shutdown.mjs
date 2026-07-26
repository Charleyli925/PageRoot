export class BridgeShutdownTimeoutError extends Error {
  constructor(timeoutMs) {
    super(
      `本地工作区服务在 ${timeoutMs} 毫秒内未确认安全退出。`
      + "应用已保持开启，也不会强制终止服务；请等待磁盘写入完成后再重试关闭。",
    );
    this.name = "BridgeShutdownTimeoutError";
    this.code = "BRIDGE_SHUTDOWN_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

function normalizedWorkspaceIssue(issue) {
  return Object.freeze({
    title: typeof issue?.title === "string" && issue.title.trim()
      ? issue.title.trim()
      : "本地项目资料暂时不可用",
    message: typeof issue?.message === "string" && issue.message.trim()
      ? issue.message.trim()
      : "当前页面内容仍保留，可以导出后重新打开源页。",
  });
}

export function createWorkspaceRecoveryMailbox() {
  let rendererReady = false;
  let pendingIssue = null;

  return Object.freeze({
    beginRendererLoad() {
      rendererReady = false;
    },
    publish(issue) {
      pendingIssue = normalizedWorkspaceIssue(issue);
      return Object.freeze({
        issue: pendingIssue,
        deliverToRenderer: rendererReady,
      });
    },
    acknowledgeRendererReady() {
      rendererReady = true;
      return pendingIssue;
    },
    inspect() {
      return Object.freeze({
        rendererReady,
        pendingIssue,
      });
    },
  });
}

function bridgeProcessError(_type, _location, report) {
  const detail = typeof report === "string" && report.trim()
    ? `：${report.trim()}`
    : "。";
  const error = new Error(`本地工作区服务关闭时发生错误${detail}`);
  error.code = "BRIDGE_SHUTDOWN_ERROR";
  return error;
}

export function stopBridgeProcessGracefully(
  child,
  {
    timeoutMs,
    requestStop = (target) => target.kill(),
  },
) {
  if (!child || typeof child.once !== "function") {
    throw new TypeError("必须提供可监听退出事件的本地工作区服务进程。");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Bridge 关闭超时必须是正整数。");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener?.("exit", handleExit);
      child.removeListener?.("error", handleError);
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const handleExit = (code) => {
      finish(resolve, { code });
    };
    const handleError = (type, location, report) => {
      finish(reject, bridgeProcessError(type, location, report));
    };

    child.once("exit", handleExit);
    child.once("error", handleError);
    timeout = setTimeout(() => {
      finish(reject, new BridgeShutdownTimeoutError(timeoutMs));
    }, timeoutMs);

    try {
      const accepted = requestStop(child);
      if (accepted === false) {
        const error = new Error("本地工作区服务拒绝了安全关闭请求。应用将保持开启。");
        error.code = "BRIDGE_SHUTDOWN_REJECTED";
        finish(reject, error);
      }
    } catch (error) {
      finish(reject, error);
    }
  });
}
