import { ProjectFileError } from "./project-files.mjs";

export function assertTrustedRendererEvent(
  event,
  { mainWindow, isTrustedRendererUrl },
) {
  const webContents = mainWindow?.webContents;
  const senderFrame = event?.senderFrame;
  if (
    !webContents
    || event?.sender !== webContents
    || senderFrame !== webContents.mainFrame
    || typeof isTrustedRendererUrl !== "function"
    || !isTrustedRendererUrl(senderFrame?.url)
  ) {
    throw new ProjectFileError(
      "UNAUTHORIZED_FILE_REQUEST",
      "文件请求未获授权。",
    );
  }
}
