export function registerProjectIpc({
  ipcMain,
  trustedProject,
  PROJECT_CHANNELS,
  PREVIEW_CHANNELS,
  EDIT_RUNTIME_CHANNELS,
  handlers,
}) {
  ipcMain.handle(PROJECT_CHANNELS.getActiveProject, trustedProject(handlers.getActiveProject));
  ipcMain.handle(PROJECT_CHANNELS.openHtml, trustedProject(handlers.openHtml));
  ipcMain.handle(PROJECT_CHANNELS.readHtml, trustedProject(handlers.readHtml));
  ipcMain.handle(PROJECT_CHANNELS.exportHtmlCopy, trustedProject(handlers.exportHtmlCopy));
  ipcMain.handle(PROJECT_CHANNELS.showInFolder, trustedProject(handlers.showInFolder));
  ipcMain.handle(PROJECT_CHANNELS.openProjectsRoot, trustedProject(handlers.openProjectsRoot));
  ipcMain.handle(
    PROJECT_CHANNELS.openInDefaultBrowser,
    trustedProject(handlers.openInDefaultBrowser),
  );
  ipcMain.handle(PROJECT_CHANNELS.renameHtml, trustedProject(handlers.renameHtml));
  ipcMain.handle(
    PROJECT_CHANNELS.activateGeneratedVersion,
    trustedProject(handlers.activateGeneratedVersion),
  );
  ipcMain.handle(
    PROJECT_CHANNELS.activateManagedWorkingCopy,
    trustedProject(handlers.activateManagedWorkingCopy),
  );
  ipcMain.handle(
    PROJECT_CHANNELS.reconcileActiveManagedSource,
    trustedProject(handlers.reconcileActiveManagedSource),
  );
  ipcMain.handle(PROJECT_CHANNELS.revealVersionFile, trustedProject(handlers.revealVersionFile));
  ipcMain.handle(PROJECT_CHANNELS.revealAiTask, trustedProject(handlers.revealAiTask));
  ipcMain.handle(PROJECT_CHANNELS.listRecentProjects, trustedProject(handlers.listRecentProjects));
  ipcMain.handle(
    PROJECT_CHANNELS.listRegisteredProjects,
    trustedProject(handlers.listRegisteredProjects),
  );
  if (PROJECT_CHANNELS.readRegisteredProjectProjection) {
    ipcMain.handle(
      PROJECT_CHANNELS.readRegisteredProjectProjection,
      trustedProject(handlers.readRegisteredProjectProjection),
    );
  }
  ipcMain.handle(
    PROJECT_CHANNELS.openRegisteredProject,
    trustedProject(handlers.openRegisteredProject),
  );
  ipcMain.handle(PROJECT_CHANNELS.openRecent, trustedProject(handlers.openRecent));
  ipcMain.handle(PROJECT_CHANNELS.forgetRecent, trustedProject(handlers.forgetRecentProject));
  ipcMain.handle(
    PROJECT_CHANNELS.acceptExternalOpen,
    trustedProject(handlers.acceptExternalFileOpen, "external_open"),
  );
  if (PROJECT_CHANNELS.acknowledgeExternalOpen) {
    ipcMain.handle(
      PROJECT_CHANNELS.acknowledgeExternalOpen,
      trustedProject(handlers.acknowledgeExternalFileOpen, "external_open_ack"),
    );
  }
  ipcMain.handle(
    PROJECT_CHANNELS.commitPreparedHtmlOpen,
    trustedProject(handlers.commitPreparedHtmlOpen, "prepared_open_commit"),
  );
  ipcMain.handle(
    PROJECT_CHANNELS.cancelPreparedHtmlOpen,
    trustedProject(handlers.cancelPreparedHtmlOpen, "prepared_open_cancel"),
  );
  ipcMain.handle(
    PROJECT_CHANNELS.finalizePreparedHtmlOpen,
    trustedProject(handlers.finalizePreparedHtmlOpen, "prepared_open_finalize"),
  );
  ipcMain.handle(
    PROJECT_CHANNELS.rollbackPreparedHtmlOpen,
    trustedProject(handlers.rollbackPreparedHtmlOpen, "prepared_open_rollback"),
  );
  ipcMain.handle(
    PREVIEW_CHANNELS.createSession,
    trustedProject(
      handlers.createPreviewSession,
      "preview_create_session",
    ),
  );
  ipcMain.handle(
    PREVIEW_CHANNELS.revokeSession,
    trustedProject(
      handlers.revokePreviewSession,
      "preview_revoke_session",
    ),
  );
  ipcMain.handle(
    EDIT_RUNTIME_CHANNELS.prepare,
    trustedProject(handlers.prepareEditAuthorRuntime, "edit_runtime_prepare"),
  );
  ipcMain.handle(
    EDIT_RUNTIME_CHANNELS.revoke,
    trustedProject(handlers.revokeEditAuthorRuntime, "edit_runtime_revoke"),
  );
}

export function unregisterProjectIpc({
  ipcMain,
  PROJECT_CHANNELS,
  EDIT_RUNTIME_CHANNELS,
}) {
  for (const channel of [
    ...Object.values(PROJECT_CHANNELS),
    ...Object.values(EDIT_RUNTIME_CHANNELS),
  ]) {
    ipcMain.removeHandler(channel);
  }
}
