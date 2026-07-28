const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
export const APPLICATION_UPDATE_INITIAL_DELAY_MS = 5_000;
export const APPLICATION_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1_000;

function publicVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return VERSION_PATTERN.test(normalized) ? normalized : null;
}

function publicPublishedAt(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function publicProgress(value) {
  const percent = Number(value?.percent);
  if (!Number.isFinite(percent)) return null;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

export function createApplicationUpdateController({
  updater,
  currentVersion,
  architecture,
  enabled,
  onStatus = () => {},
  logger = console,
  scheduleTimer = setTimeout,
  cancelTimer = clearTimeout,
}) {
  if (
    !updater
    || typeof updater.on !== "function"
    || typeof updater.removeListener !== "function"
    || typeof updater.checkForUpdates !== "function"
    || typeof updater.quitAndInstall !== "function"
  ) {
    throw new TypeError("A compatible electron-updater instance is required.");
  }

  const normalizedCurrentVersion = publicVersion(currentVersion);
  if (!normalizedCurrentVersion) {
    throw new TypeError("A semantic currentVersion is required.");
  }
  if (typeof architecture !== "string" || !architecture) {
    throw new TypeError("An architecture is required.");
  }
  if (typeof scheduleTimer !== "function" || typeof cancelTimer !== "function") {
    throw new TypeError("Compatible timer functions are required.");
  }

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = false;

  let status = Object.freeze({
    status: enabled ? "idle" : "unsupported",
    currentVersion: normalizedCurrentVersion,
    latestVersion: null,
    architecture,
    downloadPercent: null,
    publishedAt: null,
  });
  let checkPromise = null;
  let automaticCheckTimer = null;
  let automaticCheckGeneration = 0;

  const publish = (nextStatus, patch = {}) => {
    status = Object.freeze({
      ...status,
      ...patch,
      status: nextStatus,
    });
    onStatus(status);
    return status;
  };

  const updateInfoPatch = (info) => ({
    latestVersion: publicVersion(info?.version),
    publishedAt: publicPublishedAt(info?.releaseDate),
  });

  const listeners = new Map([
    ["checking-for-update", () => {
      publish("checking", {
        latestVersion: null,
        downloadPercent: null,
        publishedAt: null,
      });
    }],
    ["update-available", (info) => {
      publish("available", {
        ...updateInfoPatch(info),
        downloadPercent: 0,
      });
    }],
    ["download-progress", (progress) => {
      publish("downloading", {
        downloadPercent: publicProgress(progress),
      });
    }],
    ["update-downloaded", (info) => {
      publish("downloaded", {
        ...updateInfoPatch(info),
        downloadPercent: 100,
      });
    }],
    ["update-not-available", (info) => {
      publish("current", {
        ...updateInfoPatch(info),
        downloadPercent: null,
      });
    }],
    ["update-cancelled", () => {
      publish("unavailable", { downloadPercent: null });
    }],
    ["error", (error) => {
      logger.warn(
        "[application-update:unavailable]",
        error instanceof Error ? error.message : String(error),
      );
      publish("unavailable", { downloadPercent: null });
    }],
  ]);

  for (const [eventName, listener] of listeners) {
    updater.on(eventName, listener);
  }

  async function checkForUpdates() {
    if (!enabled) return status;
    if (checkPromise) return checkPromise;
    checkPromise = Promise.resolve()
      .then(() => updater.checkForUpdates())
      .then(() => status)
      .catch((error) => {
        listeners.get("error")(error);
        return status;
      })
      .finally(() => {
        checkPromise = null;
      });
    return checkPromise;
  }

  function stopAutomaticChecks() {
    automaticCheckGeneration += 1;
    if (automaticCheckTimer) {
      cancelTimer(automaticCheckTimer);
      automaticCheckTimer = null;
    }
  }

  function startAutomaticChecks({
    initialDelayMs = APPLICATION_UPDATE_INITIAL_DELAY_MS,
    intervalMs = APPLICATION_UPDATE_INTERVAL_MS,
  } = {}) {
    if (
      !Number.isSafeInteger(initialDelayMs)
      || initialDelayMs < 0
      || !Number.isSafeInteger(intervalMs)
      || intervalMs <= 0
    ) {
      throw new TypeError("Automatic update delays must be safe positive integers.");
    }
    stopAutomaticChecks();
    if (!enabled) return false;
    const generation = automaticCheckGeneration;
    const scheduleNext = (delayMs) => {
      automaticCheckTimer = scheduleTimer(async () => {
        automaticCheckTimer = null;
        await checkForUpdates();
        if (automaticCheckGeneration !== generation) return;
        scheduleNext(intervalMs);
      }, delayMs);
      automaticCheckTimer?.unref?.();
    };
    scheduleNext(initialDelayMs);
    return true;
  }

  function installDownloadedUpdate() {
    if (status.status !== "downloaded") return false;
    const downloadedStatus = status;
    publish("installing", { downloadPercent: 100 });
    try {
      updater.quitAndInstall();
      return true;
    } catch (error) {
      status = downloadedStatus;
      onStatus(status);
      throw error;
    }
  }

  function dispose() {
    stopAutomaticChecks();
    for (const [eventName, listener] of listeners) {
      updater.removeListener(eventName, listener);
    }
  }

  return Object.freeze({
    checkForUpdates,
    dispose,
    getStatus: () => status,
    installDownloadedUpdate,
    startAutomaticChecks,
    stopAutomaticChecks,
  });
}
