import assert from "node:assert/strict";
import test from "node:test";

import { DrainCoordinator } from "../app/application/drain-coordinator.js";

test("drain coordinator resolves registered obligations in one order", async () => {
  const coordinator = new DrainCoordinator();
  const calls = [];
  let sourcePending = true;
  let draftPending = true;
  coordinator.replace("source", {
    label: "source",
    inspect: () => sourcePending ? { state: "pending" } : { state: "resolved" },
    drain: async () => {
      calls.push("source");
      sourcePending = false;
    },
  });
  coordinator.replace("draft", {
    label: "draft",
    inspect: () => draftPending ? { state: "pending" } : { state: "resolved" },
    drain: async () => {
      calls.push("draft");
      draftPending = false;
    },
  });

  assert.deepEqual(
    await coordinator.drain("close", { deadlineAt: Date.now() + 1_000 }),
    { ok: true },
  );
  assert.deepEqual(calls, ["source", "draft"]);
});

test("drain coordinator returns one actionable hard blocker", async () => {
  const coordinator = new DrainCoordinator();
  coordinator.replace("source", {
    inspect: () => ({
      state: "blocked",
      reason: "源 HTML 与外部文件存在冲突。",
    }),
  });

  assert.deepEqual(
    await coordinator.drain("switch", { deadlineAt: Date.now() + 1_000 }),
    {
      ok: false,
      obligation: "source",
      reason: "源 HTML 与外部文件存在冲突。",
    },
  );
});

test("drain coordinator never turns an expired wait into success", async () => {
  const coordinator = new DrainCoordinator();
  coordinator.replace("attachment", {
    label: "等待附件添加完成",
    inspect: () => ({ state: "pending" }),
    drain: () => new Promise(() => {}),
  });
  const result = await coordinator.drain("close", {
    deadlineAt: Date.now() + 10,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /等待附件添加完成超时/);
});

test("an always-drain verification is not reported as permanently dirty", async () => {
  const coordinator = new DrainCoordinator();
  let verified = 0;
  coordinator.replace("draft", {
    alwaysDrain: true,
    inspect: () => ({ state: "resolved" }),
    drain: () => {
      verified += 1;
      return true;
    },
  });

  assert.equal(coordinator.hasPending("close"), false);
  assert.deepEqual(
    await coordinator.drain("close", { deadlineAt: Date.now() + 1_000 }),
    { ok: true },
  );
  assert.equal(verified, 1);
});

test("an expired boundary does not start a new mutation", async () => {
  const coordinator = new DrainCoordinator();
  let started = false;
  coordinator.replace("source", {
    label: "源 HTML",
    inspect: () => ({ state: "pending" }),
    drain: () => {
      started = true;
      return true;
    },
  });

  const result = await coordinator.drain("close", {
    deadlineAt: Date.now() - 1,
  });
  assert.equal(result.ok, false);
  assert.equal(started, false);
});
