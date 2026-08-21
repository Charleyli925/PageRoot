import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEVICE_IDENTITY_FILE_NAME,
  readOrCreateDeviceIdentity,
} from "../desktop/device-identity.mjs";
import {
  LOCAL_HUMAN_ACTOR_ID,
  createDeviceIdentifier,
  createProvenance,
  isDeviceIdentifier,
  normalizeProvenance,
} from "../shared/provenance.mjs";

async function userData(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-device-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("a device identity is created once and reused on every later launch", async (t) => {
  const userDataPath = await userData(t);
  const first = await readOrCreateDeviceIdentity({ userDataPath });
  assert.equal(first.created, true);
  assert.equal(first.persisted, true);
  assert.equal(isDeviceIdentifier(first.deviceId), true);

  const second = await readOrCreateDeviceIdentity({ userDataPath });
  assert.equal(second.created, false);
  assert.equal(second.deviceId, first.deviceId);

  const stored = JSON.parse(await readFile(
    path.join(userDataPath, DEVICE_IDENTITY_FILE_NAME),
    "utf8",
  ));
  assert.equal(stored.deviceId, first.deviceId);
});

test("an unreadable or malformed device identity is replaced, not trusted", async (t) => {
  const userDataPath = await userData(t);
  const filePath = path.join(userDataPath, DEVICE_IDENTITY_FILE_NAME);
  await writeFile(filePath, "{ not json", "utf8");
  const recovered = await readOrCreateDeviceIdentity({ userDataPath });
  assert.equal(recovered.created, true);
  assert.equal(isDeviceIdentifier(recovered.deviceId), true);

  await writeFile(
    filePath,
    `${JSON.stringify({ version: 1, deviceId: "device_bad", createdAt: "x" })}\n`,
    "utf8",
  );
  const replaced = await readOrCreateDeviceIdentity({ userDataPath });
  assert.equal(replaced.created, true);
  assert.notEqual(replaced.deviceId, "device_bad");
});

// desktop/device-identity.mjs restates the identifier pattern because it is
// packaged inside the asar while shared/provenance.mjs ships as an
// extraResource, and a relative import across that boundary only fails in the
// packaged application. Two copies of a rule are the hazard ADR 0028 names, so
// this test pins them to the same behavior from both directions.
test("the packaged and shared device identifier rules stay in agreement", async (t) => {
  const userDataPath = await userData(t);
  const custodian = await readOrCreateDeviceIdentity({ userDataPath });
  assert.equal(isDeviceIdentifier(custodian.deviceId), true);

  const sharedIdentifier = createDeviceIdentifier();
  const filePath = path.join(userDataPath, DEVICE_IDENTITY_FILE_NAME);
  await writeFile(
    filePath,
    `${JSON.stringify({
      version: 1,
      deviceId: sharedIdentifier,
      createdAt: new Date().toISOString(),
    })}\n`,
    "utf8",
  );
  const accepted = await readOrCreateDeviceIdentity({ userDataPath });
  assert.equal(accepted.created, false);
  assert.equal(accepted.deviceId, sharedIdentifier);
});

test("provenance requires a known actor kind and a real device", () => {
  const deviceId = createDeviceIdentifier();
  assert.deepEqual(createProvenance({ deviceId }), {
    actor: { kind: "human", id: LOCAL_HUMAN_ACTOR_ID },
    device: deviceId,
  });
  assert.deepEqual(
    createProvenance({ actorKind: "agent", actorId: "qoder", deviceId }),
    { actor: { kind: "agent", id: "qoder" }, device: deviceId },
  );

  for (const invalid of [
    { actor: { kind: "robot", id: "x" }, device: deviceId },
    { actor: { kind: "human", id: "" }, device: deviceId },
    { actor: { kind: "human", id: "has space" }, device: deviceId },
    { actor: { kind: "human", id: "local" }, device: "device_bad" },
    { actor: { kind: "human", id: "local" } },
    { device: deviceId },
    null,
  ]) {
    assert.throws(
      () => normalizeProvenance(invalid),
      (error) => String(error.code).startsWith("INVALID_PROVENANCE"),
    );
  }
});

test("provenance keeps only the members it validated", () => {
  const deviceId = createDeviceIdentifier();
  assert.deepEqual(
    normalizeProvenance({
      actor: { kind: "human", id: "local", nickname: "dropped" },
      device: deviceId,
      seq: 7,
    }),
    { actor: { kind: "human", id: "local" }, device: deviceId },
  );
});
