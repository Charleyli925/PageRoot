import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createTelemetryBuildConfig,
  createUsageTelemetry,
  DEFAULT_POSTHOG_HOST,
  readTelemetryBuildConfig,
} from "../desktop/usage-telemetry.mjs";
import { writeUsageTelemetryBuildConfig } from "../scripts/build-package.mjs";

const TEST_TOKEN = "phc_pagerootsynthetic";

async function temporaryUserData(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pageroot-usage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function advancingClock(start = Date.parse("2026-07-29T00:00:00.000Z")) {
  let current = start;
  return () => {
    current += 1_000;
    return current;
  };
}

function successfulFetch(calls) {
  return async (url, init) => {
    calls.push({ url, init, payload: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
}

test("installation identity persists while every launch gets a new random session", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const first = createUsageTelemetry({
    userDataPath,
    enabled: false,
  });
  await first.start();
  const firstIdentity = first.inspect();
  await first.shutdown();

  const second = createUsageTelemetry({
    userDataPath,
    enabled: false,
  });
  await second.start();
  const secondIdentity = second.inspect();
  await second.shutdown();

  assert.match(firstIdentity.installId, /^install_[0-9a-f-]{36}$/iu);
  assert.equal(secondIdentity.installId, firstIdentity.installId);
  assert.notEqual(secondIdentity.sessionId, firstIdentity.sessionId);
  assert.match(secondIdentity.sessionId, /^[0-9a-f-]{36}$/iu);
});

test("renderer data is reduced to the allowlist before queueing or sending", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const calls = [];
  const telemetry = createUsageTelemetry({
    userDataPath,
    projectToken: TEST_TOKEN,
    fetchImpl: successfulFetch(calls),
    now: advancingClock(),
    appVersion: "0.9.1",
    platform: "darwin",
    architecture: "arm64",
  });
  await telemetry.start();

  const rawProjectId = "project_private_source_identity";
  const forbiddenValues = [
    "<html><body>private page text</body></html>",
    "/Users/demo/Secret Project/report.html",
    "private-comment-body",
    "private-prompt-body",
    "attachment-secret.png",
    "raw exception contains private input",
  ];
  assert.equal(
    telemetry.captureFromRenderer({
      event: "notification_presented",
      projectId: rawProjectId,
      properties: {
        notice_code: "source_reload",
        tone: "warning",
        disposition: "direct-action",
        surface: "global",
        has_action: true,
        html: forbiddenValues[0],
        source_path: forbiddenValues[1],
        comment: forbiddenValues[2],
        prompt: forbiddenValues[3],
        attachment_name: forbiddenValues[4],
        error_message: forbiddenValues[5],
      },
    }),
    true,
  );
  assert.equal(
    telemetry.captureFromRenderer({
      event: "notification_presented",
      properties: {
        notice_code: "ai_run_cancelled",
        tone: "info",
        disposition: "background-result",
        surface: "global",
        has_action: false,
      },
    }),
    true,
  );
  assert.equal(
    telemetry.captureFromRenderer({
      event: "notification_presented",
      properties: {
        notice_code: "source_reload",
        tone: "warning",
        disposition: "direct-action",
        surface: "global",
      },
      sourcePath: forbiddenValues[1],
    }),
    false,
    "unknown top-level fields reject the complete renderer message",
  );
  assert.equal(
    telemetry.captureFromRenderer({
      event: "project_context_opened",
      properties: { registered: true },
    }),
    false,
    "events missing required allowlisted fields are rejected",
  );

  const result = await telemetry.flush();
  assert.ok(result.sent >= 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${DEFAULT_POSTHOG_HOST}/batch/`);
  const serialized = JSON.stringify(calls[0].payload);
  for (const value of [...forbiddenValues, rawProjectId]) {
    assert.doesNotMatch(serialized, new RegExp(
      value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      "u",
    ));
  }

  const notice = calls[0].payload.batch.find(
    (item) => item.event === "pageroot notification presented",
  );
  assert.ok(notice);
  assert.match(notice.properties.project_key, /^project_[a-f0-9]{24}$/u);
  assert.equal(notice.properties.$process_person_profile, false);
  assert.equal(notice.properties.$geoip_disable, true);
  assert.equal(notice.properties.$is_server, false);
  assert.equal(notice.properties.html, undefined);
  assert.equal(notice.properties.source_path, undefined);
  assert.equal(notice.properties.error_message, undefined);
  assert.ok(calls[0].payload.batch.some((item) => (
    item.event === "pageroot notification presented"
    && item.properties.notice_code === "ai_run_cancelled"
  )));
  await telemetry.shutdown();
});

test("direct edits and successful saves are aggregated before delivery", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const calls = [];
  const telemetry = createUsageTelemetry({
    userDataPath,
    projectToken: TEST_TOKEN,
    fetchImpl: successfulFetch(calls),
    now: advancingClock(),
  });
  await telemetry.start();
  for (let index = 0; index < 3; index += 1) {
    assert.equal(
      telemetry.captureFromRenderer({
        event: "direct_edit_committed",
        projectId: "project_aggregate_test",
        properties: {
          edit_kind: "text",
          property_group: "text",
        },
      }),
      true,
    );
  }
  for (let index = 0; index < 2; index += 1) {
    assert.equal(
      telemetry.captureFromRenderer({
        event: "source_persistence_changed",
        projectId: "project_aggregate_test",
        properties: {
          from_state: "writing",
          to_state: "idle",
        },
      }),
      true,
    );
  }

  await telemetry.flush();
  const events = calls.flatMap((call) => call.payload.batch);
  assert.equal(
    events.some((item) => item.event === "pageroot direct edit committed"),
    false,
  );
  assert.equal(
    events.find((item) => item.event === "pageroot direct edit batch")
      ?.properties.edit_count,
    3,
  );
  assert.equal(
    events.find((item) => item.event === "pageroot source save batch")
      ?.properties.save_count,
    2,
  );
  await telemetry.shutdown();
});

test("failed batches retain only sanitized events and preserve their original session", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const first = createUsageTelemetry({
    userDataPath,
    projectToken: TEST_TOKEN,
    fetchImpl: async () => ({ ok: false, status: 503 }),
    now: advancingClock(),
  });
  await first.start();
  const firstSessionId = first.inspect().sessionId;
  first.captureFromRenderer({
    event: "renderer_fault",
    projectId: "project_restart_queue",
    properties: {
      kind: "window_error",
      fingerprint: "abcdef1234567890",
      fatal: false,
      message: "raw secret must never persist",
      stack: "/Users/demo/private.html:1",
    },
  });
  const failed = await first.flush();
  assert.equal(failed.sent, 0);
  await first.shutdown({ timeoutMs: 20 });

  const stateText = await readFile(
    path.join(userDataPath, "usage-telemetry.json"),
    "utf8",
  );
  assert.doesNotMatch(stateText, /raw secret|private\.html|project_restart_queue/u);
  assert.match(stateText, new RegExp(firstSessionId, "u"));

  const calls = [];
  const second = createUsageTelemetry({
    userDataPath,
    projectToken: TEST_TOKEN,
    fetchImpl: successfulFetch(calls),
    now: advancingClock(Date.parse("2026-07-29T01:00:00.000Z")),
  });
  await second.start();
  const secondSessionId = second.inspect().sessionId;
  await second.flush();
  const restoredFault = calls
    .flatMap((call) => call.payload.batch)
    .find((item) => item.event === "pageroot renderer fault");
  assert.ok(restoredFault);
  assert.equal(restoredFault.properties.$session_id, firstSessionId);
  assert.notEqual(restoredFault.properties.$session_id, secondSessionId);
  await second.shutdown();
});

test("the bounded queue cannot delete newer events when an older batch completes late", async (t) => {
  const userDataPath = await temporaryUserData(t);
  let releaseFirstBatch;
  let fetchCount = 0;
  const telemetry = createUsageTelemetry({
    userDataPath,
    projectToken: TEST_TOKEN,
    now: advancingClock(),
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Promise((resolve) => {
          releaseFirstBatch = () => resolve({ ok: true, status: 200 });
        });
      }
      return { ok: false, status: 503 };
    },
  });
  await telemetry.start();
  for (let index = 0; index < 520; index += 1) {
    telemetry.captureFromRenderer({
      event: "notification_presented",
      properties: {
        notice_code: "source_reload",
        tone: "warning",
        disposition: "direct-action",
        surface: "global",
        has_action: true,
      },
    });
  }
  assert.equal(telemetry.inspect().pending, 500);
  const joinedFlush = telemetry.flush();
  assert.equal(typeof releaseFirstBatch, "function");
  releaseFirstBatch();
  await joinedFlush;
  assert.equal(
    telemetry.inspect().pending,
    500,
    "completion removes only matching insert IDs, not the newer queue head",
  );
  await telemetry.shutdown({ timeoutMs: 20 });
});

test("release config accepts only a public Project token and HTTPS origin", async (t) => {
  assert.deepEqual(
    createTelemetryBuildConfig({
      PAGEROOT_POSTHOG_TOKEN: TEST_TOKEN,
      PAGEROOT_POSTHOG_HOST: "https://us.i.posthog.com/",
    }),
    {
      version: 1,
      enabled: true,
      host: DEFAULT_POSTHOG_HOST,
      projectToken: TEST_TOKEN,
    },
  );
  assert.throws(
    () => createTelemetryBuildConfig({
      PAGEROOT_POSTHOG_TOKEN: "phx_secret_key",
    }),
    /phc_ project-token format/u,
  );
  assert.throws(
    () => createTelemetryBuildConfig({
      PAGEROOT_POSTHOG_HOST: "http://us.i.posthog.com",
    }),
    /HTTPS origin/u,
  );

  const productRoot = await temporaryUserData(t);
  const result = await writeUsageTelemetryBuildConfig({
    productRoot,
    environment: {
      PAGEROOT_REQUIRE_TELEMETRY_CONFIG: "1",
      PAGEROOT_POSTHOG_TOKEN: TEST_TOKEN,
      PAGEROOT_POSTHOG_HOST: DEFAULT_POSTHOG_HOST,
    },
  });
  const restored = await readTelemetryBuildConfig(result.destination);
  assert.equal(restored.enabled, true);
  assert.equal(restored.projectToken, TEST_TOKEN);
  assert.equal(restored.host, DEFAULT_POSTHOG_HOST);
  await assert.rejects(
    writeUsageTelemetryBuildConfig({
      productRoot,
      environment: {
        PAGEROOT_REQUIRE_TELEMETRY_CONFIG: "1",
      },
    }),
    /PAGEROOT_POSTHOG_TOKEN is required/u,
  );
});

test("telemetry source has no hardware-identity implementation route", async () => {
  const source = await readFile(
    new URL("../desktop/usage-telemetry.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /systemProfiler|serialNumber|hardwareUuid|IOPlatformUUID|ioreg|machineId|deviceName/iu,
  );
  assert.match(source, /`install_\$\{randomUUID\(\)\}`/u);
});
