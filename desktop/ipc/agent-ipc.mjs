import { ProjectFileError } from "../project-files.mjs";
import { handoffToQoderWork } from "../qoder-handoff.mjs";

export function registerAgentIpc({
  ipcMain,
  trustedProject,
  INTEGRATION_CHANNELS,
  clipboard,
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
}

export function unregisterAgentIpc({ ipcMain, INTEGRATION_CHANNELS }) {
  for (const channel of Object.values(INTEGRATION_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}
