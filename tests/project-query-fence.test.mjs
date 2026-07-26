import assert from "node:assert/strict";
import test from "node:test";

import { ProjectQueryFence } from "../app/application/project-query-fence.js";

const identity = {
  epoch: 3,
  projectId: "proj_1",
  documentId: "doc_1",
  sourcePath: "/tmp/page.html",
};

test("newer same-project query invalidates the older response", () => {
  const fence = new ProjectQueryFence();
  const stale = fence.begin(identity, "workspace");
  const current = fence.begin(identity, "workspace");

  assert.equal(fence.isCurrent(stale), false);
  assert.equal(fence.isCurrent(current), true);
});
test("query families and project identities do not invalidate each other", () => {
  const fence = new ProjectQueryFence();
  const workspace = fence.begin(identity, "workspace");
  const source = fence.begin(identity, "source");
  const otherProject = fence.begin({
    ...identity,
    projectId: "proj_2",
    sourcePath: "/tmp/other.html",
  }, "workspace");

  assert.equal(fence.isCurrent(workspace), true);
  assert.equal(fence.isCurrent(source), true);
  assert.equal(fence.isCurrent(otherProject), true);
});
