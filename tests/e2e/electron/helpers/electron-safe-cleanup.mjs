import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_USER_DATA_PREFIX = "pageroot-native-e2e-";
const DEFAULT_CLOSE_TIMEOUT = 5_000;
const DEFAULT_EXIT_REQUEST_TIMEOUT = 1_000;
const DEFAULT_EXIT_TIMEOUT = 3_000;
const DEFAULT_TERMINATE_TIMEOUT = 1_000;
const DEFAULT_CLOSE_OBSERVATION_GRACE = 1_000;
const stopPromiseKey = Symbol("pagerootAppFixtureStopPromise");

export function closeObservationTimeout(timeout = DEFAULT_CLOSE_TIMEOUT) {
  const shutdownBudget = DEFAULT_EXIT_REQUEST_TIMEOUT
    + DEFAULT_EXIT_TIMEOUT
    + (DEFAULT_TERMINATE_TIMEOUT * 2)
    + DEFAULT_CLOSE_OBSERVATION_GRACE;
  return Math.max(timeout, shutdownBudget);
}

function waitForProcessExit(electronProcess, timeout) {
  return new Promise((resolve) => {
    if (electronProcess.exitCode !== null || electronProcess.signalCode !== null) {
      resolve(true);
      return;
    }
    let timer = null;
    const onExit = () => {
      if (timer) clearTimeout(timer);
      resolve(true);
    };
    timer = setTimeout(() => {
      electronProcess.off("exit", onExit);
      resolve(false);
    }, timeout);
    electronProcess.once("exit", onExit);
  });
}

/**
 * Builds the close-before-cleanup contract without module-global state.
 * Exported so the teardown ordering can be verified without launching Electron.
 */
export function createCloseFirstCleanup({
  requestExit,
  waitForExit,
  waitForClose,
  terminate,
  cleanup,
  exitTimeout = DEFAULT_EXIT_TIMEOUT,
  terminateTimeout = DEFAULT_TERMINATE_TIMEOUT,
}) {
  let stopPromise = null;
  return async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      await requestExit();
      let processExited = await waitForExit(exitTimeout);
      if (!processExited) {
        await terminate("SIGTERM");
        processExited = await waitForExit(terminateTimeout);
        if (!processExited) {
          await terminate("SIGKILL");
          processExited = await waitForExit(terminateTimeout);
        }
      }
      const closeObserved = await waitForClose();
      if (!closeObserved && !processExited) {
        throw new Error("PageRoot exit could not be confirmed; temporary data was preserved.");
      }
      await cleanup();
    })();
    return stopPromise;
  };
}

export function removeValidatedTemporaryDirectory(directoryPath, namePrefix) {
  const resolved = path.resolve(directoryPath);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith(namePrefix)
  ) {
    throw new Error(`Refusing to remove non-E2E temporary data: ${directoryPath}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

export async function stopPageRoot(
  electronApp,
  isolatedUserData,
  {
    cleanup = true,
    cleanupPrefix = DEFAULT_USER_DATA_PREFIX,
    closeTimeout = DEFAULT_CLOSE_TIMEOUT,
  } = {},
) {
  if (electronApp[stopPromiseKey]) return electronApp[stopPromiseKey];
  const electronProcess = electronApp.process();
  const applicationClosed = electronApp
    .waitForEvent("close", { timeout: closeObservationTimeout(closeTimeout) })
    .then(() => true)
    .catch(() => false);
  const stop = createCloseFirstCleanup({
    requestExit: () => Promise.race([
      electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, DEFAULT_EXIT_REQUEST_TIMEOUT)),
    ]),
    waitForExit: (timeout) => waitForProcessExit(electronProcess, timeout),
    waitForClose: () => applicationClosed,
    terminate: async (signal) => {
      if (electronProcess.exitCode === null && electronProcess.signalCode === null) {
        electronProcess.kill(signal);
      }
    },
    cleanup: () => {
      if (cleanup) removeValidatedTemporaryDirectory(isolatedUserData, cleanupPrefix);
    },
  });
  const stopPromise = stop();
  Object.defineProperty(electronApp, stopPromiseKey, {
    value: stopPromise,
  });
  return stopPromise;
}

export async function closePageRootGracefully(electronApp, page, {
  timeout = 35_000,
} = {}) {
  const mainRendererUrl = page?.url();
  if (!mainRendererUrl) {
    throw new Error("PageRoot main renderer URL is unavailable for graceful close.");
  }
  await page.evaluate(() => {
    window.__PAGEROOT_CLOSE_ABORT_REASON__ = null;
    window.addEventListener("html-ai:close-aborted", (event) => {
      window.__PAGEROOT_CLOSE_ABORT_REASON__ = event.detail?.reason || "unknown";
    }, { once: true });
  });
  const closed = electronApp.waitForEvent("close", { timeout });
  const requested = await electronApp.evaluate(({ BrowserWindow }, rendererUrl) => {
    const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
      candidate.webContents.getURL() === rendererUrl
    ));
    if (!mainWindow) return false;
    mainWindow.close();
    return true;
  }, mainRendererUrl);
  if (!requested) {
    throw new Error("PageRoot main BrowserWindow was unavailable for graceful close.");
  }
  try {
    await closed;
  } catch (error) {
    const reason = await page.evaluate(
      () => window.__PAGEROOT_CLOSE_ABORT_REASON__,
    ).catch(() => null);
    throw new Error(
      `PageRoot graceful close did not complete${reason ? `: ${reason}` : "."}`,
      { cause: error },
    );
  }
}
