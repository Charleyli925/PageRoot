export function registerWindowIpc({
  ipcMain,
  trusted,
  trustedProject,
  APP_CHANNELS,
  EDIT_CHANNELS,
  UI_PREFERENCE_CHANNELS,
  USAGE_CHANNELS,
  openUserNotice,
  reportCloseResult,
  acknowledgeWorkspaceRecoveryReady,
  peekExternalOpenReady,
  relaunchApplication,
  applyNativeHistory,
  getUiPreferences,
  recordUiPreference,
  assertTrustedEvent,
  captureUsageFromRenderer,
}) {
  ipcMain.handle(
    APP_CHANNELS.openUserNotice,
    trustedProject(openUserNotice),
  );
  ipcMain.handle(APP_CHANNELS.closeResult, trusted(reportCloseResult));
  ipcMain.handle(
    APP_CHANNELS.workspaceRecoveryReady,
    trusted(acknowledgeWorkspaceRecoveryReady),
  );
  ipcMain.handle(
    APP_CHANNELS.externalOpenReady,
    trusted(peekExternalOpenReady),
  );
  ipcMain.handle(
    APP_CHANNELS.relaunch,
    trusted(relaunchApplication),
  );
  ipcMain.handle(
    EDIT_CHANNELS.nativeHistory,
    trusted(applyNativeHistory),
  );
  ipcMain.handle(
    UI_PREFERENCE_CHANNELS.get,
    trustedProject(getUiPreferences, "ui_preferences_get"),
  );
  ipcMain.handle(
    UI_PREFERENCE_CHANNELS.record,
    trustedProject(recordUiPreference, "ui_preferences_record"),
  );
  ipcMain.on(USAGE_CHANNELS.capture, (event, payload) => {
    try {
      assertTrustedEvent(event);
      captureUsageFromRenderer(payload);
    } catch {
      // Usage reporting is deliberately best-effort and never changes product flow.
    }
  });
}

export function unregisterWindowIpc({
  ipcMain,
  APP_CHANNELS,
  EDIT_CHANNELS,
  UI_PREFERENCE_CHANNELS,
  USAGE_CHANNELS,
}) {
  for (const channel of [
    ...Object.values(UI_PREFERENCE_CHANNELS),
    APP_CHANNELS.closeResult,
    APP_CHANNELS.workspaceRecoveryReady,
    APP_CHANNELS.externalOpenReady,
    APP_CHANNELS.relaunch,
    EDIT_CHANNELS.nativeHistory,
  ]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.removeAllListeners(USAGE_CHANNELS.capture);
}
