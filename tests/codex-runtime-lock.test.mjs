import assert from "node:assert/strict";
import test from "node:test";

import { verifyCodexRuntimeLock } from "../scripts/verify-codex-runtime-lock.mjs";

test("pinned codex-acp, Codex binary, and generated App Server schemas stay exact", async () => {
  const manifest = await verifyCodexRuntimeLock();
  assert.equal(manifest.adapter.version, "1.6.2");
  assert.equal(manifest.codex.version, "0.148.0");
  assert.equal(manifest.codex.supportedPackageTarget, "darwin-arm64");
});
