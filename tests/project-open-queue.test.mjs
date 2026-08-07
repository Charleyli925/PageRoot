import assert from "node:assert/strict";
import test from "node:test";

import { createProjectOpenQueue } from "../desktop/project-open-queue.mjs";

test("project open queue serializes whole transitions in arrival order", async () => {
  const queue = createProjectOpenQueue();
  const order = [];
  let releaseFirst;
  const firstReleased = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });

  const first = queue.run(async () => {
    order.push("first:start");
    markFirstStarted();
    await firstReleased;
    order.push("first:finish");
    return "first";
  });
  await firstStarted;
  const failed = queue.run(async () => {
    order.push("failed:start");
    throw new Error("unreadable HTML");
  });
  const latest = queue.run(async () => {
    order.push("latest:start");
    order.push("latest:finish");
    return "latest";
  });

  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await assert.rejects(failed, /unreadable HTML/u);
  assert.deepEqual(await Promise.all([first, latest]), ["first", "latest"]);
  assert.deepEqual(order, [
    "first:start",
    "first:finish",
    "failed:start",
    "latest:start",
    "latest:finish",
  ]);
});
