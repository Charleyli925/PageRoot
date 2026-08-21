function writeShutdownAborted(writeDiagnostic) {
  writeDiagnostic(`${JSON.stringify({
    type: "shutdown-aborted",
    error: {
      code: "AGENT_SHUTDOWN_UNCONFIRMED",
      message: "PageRoot 无法确认本机 Agent 已停止；Bridge 将保持运行。",
    },
  })}\n`);
}

export async function cancelDurableRequestAfterAgentCleanup({
  cancelAgent,
  cancelRequest,
} = {}) {
  if (typeof cancelAgent !== "function" || typeof cancelRequest !== "function") {
    throw new TypeError("Workspace Bridge cancellation dependencies are invalid.");
  }
  await cancelAgent();
  return cancelRequest();
}

export async function closeWorkspaceBridgeAfterAgentCleanup({
  agentBridgeService,
  closeServer,
  exitProcess,
  writeDiagnostic,
} = {}) {
  if (
    typeof agentBridgeService?.dispose !== "function"
    || typeof closeServer !== "function"
    || typeof exitProcess !== "function"
    || typeof writeDiagnostic !== "function"
  ) {
    throw new TypeError("Workspace Bridge shutdown dependencies are invalid.");
  }

  try {
    await agentBridgeService.dispose();
  } catch {
    writeShutdownAborted(writeDiagnostic);
    return false;
  }

  try {
    closeServer(() => exitProcess(0));
  } catch {
    writeShutdownAborted(writeDiagnostic);
    return false;
  }
  return true;
}
