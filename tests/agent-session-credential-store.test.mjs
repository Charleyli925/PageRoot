import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentSessionCredentialStore } from "../desktop/agent-session-credential-store.mjs";

function memorySafeStorage() {
  return {
    available: true,
    encryptString(value) {
      return Buffer.from(`enc:${value}`, "utf8");
    },
    decryptString(buffer) {
      const text = Buffer.from(buffer).toString("utf8");
      return text.startsWith("enc:") ? text.slice(4) : "";
    },
  };
}

test("remembered Key is stored as ciphertext and never written in plaintext", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "pageroot-credential-"));
  const crypto = memorySafeStorage();
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: (value) => crypto.encryptString(value),
    decryptString: (buffer) => crypto.decryptString(buffer),
    isEncryptionAvailable: () => crypto.available,
  });

  const persisted = await store.persist({
    apiKey: "sk-secret",
    vendorId: "deepseek",
  });
  assert.equal(persisted.ok, true);
  const raw = await readFile(path.join(userDataPath, "agent-session-credential.v1.json"), "utf8");
  assert.doesNotMatch(raw, /sk-secret/u);
  const loaded = await store.load();
  assert.equal(loaded.apiKey, "sk-secret");
  assert.equal(loaded.vendorId, "deepseek");
  const status = await store.publicStatus();
  assert.equal(status.remembered, true);
  assert.equal(status.vendorId, "deepseek");
  assert.equal("apiKey" in status, false);
});

test("unavailable encryption refuses to persist and does not fall back to plaintext", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "pageroot-credential-"));
  const store = createAgentSessionCredentialStore({
    userDataPath,
    encryptString: () => Buffer.from("nope"),
    decryptString: () => "sk-secret",
    isEncryptionAvailable: () => false,
  });
  const persisted = await store.persist({
    apiKey: "sk-secret",
    vendorId: "deepseek",
  });
  assert.equal(persisted.ok, false);
  assert.equal(persisted.code, "AGENT_CREDENTIAL_STORE_UNAVAILABLE");
  assert.equal(await store.load(), null);
});
