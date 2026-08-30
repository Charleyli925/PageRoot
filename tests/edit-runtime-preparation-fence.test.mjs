import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditRuntimePreparationFence,
} from "../desktop/edit-runtime-preparation-fence.mjs";

const SOURCE_SHA = "sha256:" + "a".repeat(64);

function preparation({
  requestId = "edit-runtime-request-0001",
  sourcePath = "/projects/report.html",
  sourceSha256 = SOURCE_SHA,
  canvasGeneration = 1,
} = {}) {
  return { requestId, sourcePath, sourceSha256, canvasGeneration };
}

test("Main-owned Edit runtime fence consumes request identities but permits a later disposable page", () => {
  const fence = createEditRuntimePreparationFence();
  const release = fence.claim(preparation());
  release();
  release();

  assert.throws(
    () => fence.claim(preparation()),
    /already consumed/u,
  );
  const nextRelease = fence.claim(preparation({
    requestId: "edit-runtime-request-0002",
  }));
  nextRelease();
});

test("Main-owned Edit runtime fence permits only the bounded activation overlap", () => {
  const fence = createEditRuntimePreparationFence();
  const releaseFirst = fence.claim(preparation());
  const releaseSecond = fence.claim(preparation({
    requestId: "edit-runtime-request-0002",
    sourcePath: "/projects/second-report.html",
  }));

  assert.throws(
    () => fence.claim(preparation({
      requestId: "edit-runtime-request-0003",
      sourcePath: "/projects/third-report.html",
    })),
    /already in progress/u,
  );

  releaseFirst();
  releaseSecond();
  const nextRelease = fence.claim(preparation({
    requestId: "edit-runtime-request-0003",
    sourcePath: "/projects/third-report.html",
  }));
  nextRelease();
});

test("Main-owned Edit runtime fence keeps a non-evicting application lifetime cap", () => {
  const fence = createEditRuntimePreparationFence({ maximumConsumedPreparations: 1 });
  const release = fence.claim(preparation());
  release();

  const nextPreparation = preparation({
    requestId: "edit-runtime-request-0002",
    sourcePath: "/projects/second-report.html",
  });
  assert.throws(
    () => fence.claim(nextPreparation),
    /lifetime limit/u,
  );
  assert.throws(
    () => fence.claim(preparation()),
    /already consumed/u,
  );
});
