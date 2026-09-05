import { ProjectFileError } from "../project-files.mjs";
import { handoffToQoderWork } from "../qoder-handoff.mjs";

const LOGIN_PROVIDER_IDS = new Set(["qoder", "codex"]);

export function registerAgentIpc({
  ipcMain,
  trustedProject,
  INTEGRATION_CHANNELS,
  clipboard,
  openAgentLogin,
}) {
  ipcMain.handle(
    INTEGRATION_CHANNELS.qoderHandoff,
    trustedProject((payload) => {
      if (
        process.env.PAGEROOT_E2E === "1"
        && process.env.PAGEROOT_E2E_QODER_HANDOFF_FAILURE === "1"
      ) {
        throw new ProjectFileError(
          "E2E_QODER_HANDOFF_FAILED",
          "测试注入：交接内容未能写入剪贴板。",
        );
      }
      return handoffToQoderWork(payload, {
        writeClipboard: (message) => clipboard.writeText(message),
        readClipboard: () => clipboard.readText(),
      });
    }, "qoder_handoff"),
  );
  ipcMain.handle(
    INTEGRATION_CHANNELS.openAgentLogin,
    trustedProject(async (payload) => {
      const providerId = String(payload?.providerId || "").trim();
      if (!LOGIN_PROVIDER_IDS.has(providerId)) {
        throw new ProjectFileError(
          "AGENT_LOGIN_UNSUPPORTED",
          "This Agent cannot start an official login.",
        );
      }
      if (typeof openAgentLogin !== "function") {
        throw new ProjectFileError(
          "AGENT_LOGIN_URL_UNAVAILABLE",
          "官方登录页暂时无法打开。",
        );
      }
      return openAgentLogin(providerId);
    }, "agent_open_login"),
  );
}

export function unregisterAgentIpc({ ipcMain, INTEGRATION_CHANNELS }) {
  for (const channel of Object.values(INTEGRATION_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}
