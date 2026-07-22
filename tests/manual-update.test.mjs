import assert from "node:assert/strict";
import test from "node:test";

import {
  LATEST_RELEASE_PAGE_URL,
  ManualUpdateError,
  PROJECT_REPOSITORY_URL,
  UPDATE_MANIFEST_MAX_BYTES,
  UPDATE_MANIFEST_URL,
  checkForManualUpdate,
  compareStrictVersions,
  validateUpdateManifest,
} from "../desktop/manual-update.mjs";

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    version: "0.7.4",
    minimumMacOS: "12.0",
    architectures: ["arm64"],
    publishedAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

function response(body, {
  ok = true,
  status = 200,
  contentLength,
} = {}) {
  const bytes = new TextEncoder().encode(
    typeof body === "string" ? body : JSON.stringify(body),
  );
  return {
    ok,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() !== "content-length") return null;
        return String(contentLength ?? bytes.byteLength);
      },
    },
    async arrayBuffer() {
      return bytes.buffer;
    },
  };
}

test("manual update endpoints are pinned to the public PageRoot release repository", () => {
  assert.equal(
    UPDATE_MANIFEST_URL,
    "https://github.com/Charleyli925/PageRoot/releases/latest/download/update-manifest.json",
  );
  assert.equal(
    LATEST_RELEASE_PAGE_URL,
    "https://github.com/Charleyli925/PageRoot/releases/latest",
  );
  assert.equal(
    PROJECT_REPOSITORY_URL,
    "https://github.com/Charleyli925/PageRoot",
  );
});

test("strict versions compare without prerelease or loose coercion", () => {
  assert.equal(compareStrictVersions("0.7.3", "0.7.4"), -1);
  assert.equal(compareStrictVersions("0.7.4", "0.7.4"), 0);
  assert.equal(compareStrictVersions("1.0.0", "0.99.99"), 1);
  for (const invalid of ["v0.7.4", "0.7", "0.7.4-beta.1", "01.2.3"]) {
    assert.throws(
      () => compareStrictVersions("0.7.3", invalid),
      (error) => error instanceof ManualUpdateError
        && error.code === "INVALID_VERSION",
    );
  }
});

test("update manifests are strict, bounded and architecture-aware", () => {
  assert.deepEqual(
    validateUpdateManifest(manifest()),
    manifest(),
  );
  for (const invalid of [
    manifest({ schemaVersion: 2 }),
    manifest({ version: "v0.7.4" }),
    manifest({ minimumMacOS: "latest" }),
    manifest({ architectures: [] }),
    manifest({ architectures: ["arm64", "arm64"] }),
    manifest({ architectures: ["universal"] }),
    manifest({ publishedAt: "today" }),
    { ...manifest(), downloadUrl: "https://example.com/fake.dmg" },
  ]) {
    assert.throws(
      () => validateUpdateManifest(invalid),
      (error) => error instanceof ManualUpdateError
        && error.code === "INVALID_MANIFEST",
    );
  }
});

test("manual update checks classify newer, current and unsupported releases", async () => {
  const requests = [];
  const fetchImpl = async (...args) => {
    requests.push(args);
    return response(manifest());
  };
  assert.equal(
    (await checkForManualUpdate({
      currentVersion: "0.7.3",
      architecture: "arm64",
      fetchImpl,
    })).status,
    "available",
  );
  assert.equal(
    (await checkForManualUpdate({
      currentVersion: "0.7.4",
      architecture: "arm64",
      fetchImpl,
    })).status,
    "current",
  );
  assert.equal(
    (await checkForManualUpdate({
      currentVersion: "0.7.3",
      architecture: "x64",
      fetchImpl,
    })).status,
    "unsupported",
  );
  assert.equal(requests[0][0], UPDATE_MANIFEST_URL);
  assert.equal(requests[0][1].redirect, "follow");
  assert.equal(requests[0][1].cache, "no-store");
});

test("manual update checks reject HTTP errors, malformed and oversized data", async () => {
  await assert.rejects(
    checkForManualUpdate({
      currentVersion: "0.7.3",
      architecture: "arm64",
      fetchImpl: async () => response("", { ok: false, status: 404 }),
    }),
    (error) => error instanceof ManualUpdateError
      && error.code === "UPDATE_HTTP_ERROR",
  );
  await assert.rejects(
    checkForManualUpdate({
      currentVersion: "0.7.3",
      architecture: "arm64",
      fetchImpl: async () => response("{"),
    }),
    (error) => error instanceof ManualUpdateError
      && error.code === "INVALID_MANIFEST",
  );
  await assert.rejects(
    checkForManualUpdate({
      currentVersion: "0.7.3",
      architecture: "arm64",
      fetchImpl: async () => response("{}", {
        contentLength: UPDATE_MANIFEST_MAX_BYTES + 1,
      }),
    }),
    (error) => error instanceof ManualUpdateError
      && error.code === "MANIFEST_TOO_LARGE",
  );
});

test("manual update checks time out without leaking low-level failures", async () => {
  await assert.rejects(
    checkForManualUpdate({
      currentVersion: "0.7.3",
      architecture: "arm64",
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("socket and proxy details"), {
            name: "AbortError",
          }));
        });
      }),
    }),
    (error) => error instanceof ManualUpdateError
      && error.code === "UPDATE_TIMEOUT"
      && !error.message.includes("socket"),
  );
});
