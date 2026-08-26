import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createBrowserFileTabIdentity } from "../app/application/browser-file-tab-identity.js";

function sha256(value) {
  return Promise.resolve(`sha256:${createHash("sha256").update(value).digest("hex")}`);
}

test("browser file tab identity is stable for reselection and distinguishes same-content names", async () => {
  const input = {
    name: "页面甲.html",
    size: 128,
    lastModified: 1_786_000_000_000,
    sourceSha256: await sha256("same html"),
    sha256,
  };
  const first = await createBrowserFileTabIdentity(input);
  const repeated = await createBrowserFileTabIdentity(input);
  const renamed = await createBrowserFileTabIdentity({ ...input, name: "页面乙.html" });

  assert.deepEqual(repeated, first);
  assert.notDeepEqual(renamed, first);
  assert.match(first.projectId, /^project_[A-Za-z0-9_-]+$/u);
  assert.match(first.documentId, /^doc_[A-Za-z0-9_-]+$/u);
  assert.equal("sourcePath" in first, false);
  assert.equal("html" in first, false);
  assert.equal("sourceSha256" in first, false);
});
