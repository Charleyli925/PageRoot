export async function snapshotElectronClipboard(electronApp) {
  const formats = await electronApp.evaluate(({ clipboard }) => (
    clipboard.availableFormats().sort()
  ));
  return { formats };
}

export async function restoreElectronClipboard(electronApp, snapshot) {
  await electronApp.evaluate(({ clipboard }) => {
    clipboard.clear();
  });
  const restored = await snapshotElectronClipboard(electronApp);
  if (snapshot.formats.length !== 0 || restored.formats.length !== 0) {
    const error = new Error(
      "Electron clipboard did not return to the required empty state. "
      + `Observed ${JSON.stringify(restored.formats)} after restore.`,
    );
    error.code = "CLIPBOARD_RESTORE_MISMATCH";
    error.expected = [];
    error.actual = restored.formats;
    throw error;
  }
  return restored;
}

export async function withRestoredElectronClipboard(electronApp, action) {
  const snapshot = await snapshotElectronClipboard(electronApp);
  if (snapshot.formats.length > 0) {
    const error = new Error(
      `Clipboard is not empty; system clipboard preservation is deferred from this gate (${snapshot.formats.length} formats).`,
    );
    error.code = "CLIPBOARD_FORMAT_UNSUPPORTED";
    error.formats = snapshot.formats;
    throw error;
  }
  try {
    return await action();
  } finally {
    await restoreElectronClipboard(electronApp, snapshot);
  }
}
