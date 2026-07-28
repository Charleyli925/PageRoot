import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createApplicationUpdateController } from "../desktop/application-update.mjs";

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCount = 0;
    this.installCount = 0;
    this.checkResult = Promise.resolve();
  }

  checkForUpdates() {
    this.checkCount += 1;
    return this.checkResult;
  }

  quitAndInstall() {
    this.installCount += 1;
  }
}

function controller(options = {}) {
  const updater = options.updater || new FakeUpdater();
  const statuses = [];
  return {
    updater,
    statuses,
    value: createApplicationUpdateController({
      updater,
      currentVersion: "0.9.0",
      architecture: "arm64",
      enabled: true,
      logger: { warn() {} },
      onStatus: (status) => statuses.push(status),
      ...options,
    }),
  };
}

test("stable updater automatically downloads but never installs on ordinary quit", () => {
  const { updater, value } = controller();

  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.autoRunAppAfterInstall, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.disableDifferentialDownload, false);
  assert.deepEqual(value.getStatus(), {
    status: "idle",
    currentVersion: "0.9.0",
    latestVersion: null,
    architecture: "arm64",
    downloadPercent: null,
    publishedAt: null,
  });
  assert.equal(Object.isFrozen(value.getStatus()), true);
});

test("update events expose bounded public progress and a restart-ready state", () => {
  const { updater, value, statuses } = controller();

  updater.emit("checking-for-update");
  updater.emit("update-available", {
    version: "0.10.0",
    releaseDate: "2026-07-28T12:00:00.000Z",
  });
  updater.emit("download-progress", { percent: 42.345 });
  updater.emit("download-progress", { percent: 120 });
  updater.emit("update-downloaded", {
    version: "0.10.0",
    releaseDate: "2026-07-28T12:00:00.000Z",
  });

  assert.deepEqual(
    statuses.map((status) => [status.status, status.downloadPercent]),
    [
      ["checking", null],
      ["available", 0],
      ["downloading", 42.3],
      ["downloading", 100],
      ["downloaded", 100],
    ],
  );
  assert.deepEqual(value.getStatus(), {
    status: "downloaded",
    currentVersion: "0.9.0",
    latestVersion: "0.10.0",
    architecture: "arm64",
    downloadPercent: 100,
    publishedAt: "2026-07-28T12:00:00.000Z",
  });
});

test("only a downloaded update may start installation", () => {
  const { updater, value } = controller();

  assert.equal(value.installDownloadedUpdate(), false);
  assert.equal(updater.installCount, 0);

  updater.emit("update-downloaded", { version: "0.10.0" });
  assert.equal(value.installDownloadedUpdate(), true);
  assert.equal(updater.installCount, 1);
  assert.equal(value.getStatus().status, "installing");
  assert.equal(value.installDownloadedUpdate(), false);
});

test("disabled environments never contact the release provider", async () => {
  const updater = new FakeUpdater();
  const value = createApplicationUpdateController({
    updater,
    currentVersion: "0.9.0",
    architecture: "arm64",
    enabled: false,
  });

  assert.equal((await value.checkForUpdates()).status, "unsupported");
  assert.equal(updater.checkCount, 0);
});

test("concurrent checks share one provider request and errors stay unavailable", async () => {
  const updater = new FakeUpdater();
  let rejectCheck;
  updater.checkResult = new Promise((_resolve, reject) => {
    rejectCheck = reject;
  });
  const warnings = [];
  const { value } = controller({
    updater,
    logger: { warn: (...args) => warnings.push(args) },
  });

  const first = value.checkForUpdates();
  const second = value.checkForUpdates();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.checkCount, 1);
  rejectCheck(new Error("provider details"));
  assert.equal((await first).status, "unavailable");
  assert.equal((await second).status, "unavailable");
  assert.equal(warnings.length, 1);
});

test("controller releases every updater listener", () => {
  const { updater, value } = controller();

  assert.ok(updater.eventNames().length > 0);
  value.dispose();
  assert.deepEqual(updater.eventNames(), []);
});
