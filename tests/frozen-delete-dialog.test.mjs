import assert from "node:assert/strict";
import test from "node:test";

import { withExpectedDeleteConfirmation } from "./e2e/electron/real-html/expected-delete-dialog.mjs";

class FakePage {
  #listeners = new Set();

  on(name, listener) {
    if (name === "dialog") this.#listeners.add(listener);
  }

  off(name, listener) {
    if (name === "dialog") this.#listeners.delete(listener);
  }

  emitDialog(dialog) {
    for (const listener of this.#listeners) listener(dialog);
  }
}

function dialog({ type = "confirm", message = "确定删除“副本”及其全部内容吗？", acceptGate = null, acceptError = null } = {}) {
  return {
    type: () => type,
    message: () => message,
    accepted: false,
    dismissed: false,
    async accept() {
      if (acceptGate) await acceptGate;
      if (acceptError) throw acceptError;
      this.accepted = true;
    },
    async dismiss() { this.dismissed = true; },
  };
}

test("expected delete helper accepts one matching confirmation and cleans its listener", async () => {
  const page = new FakePage();
  const confirmation = dialog();
  const result = await withExpectedDeleteConfirmation(page, () => page.emitDialog(confirmation), { targetText: "副本" });
  assert.equal(result.decision, "accept");
  assert.equal(confirmation.accepted, true);
  assert.equal(confirmation.dismissed, false);
  await assert.rejects(
    withExpectedDeleteConfirmation(page, async () => {}),
    { code: "FROZEN_DELETE_DIALOG_EXPECTATION_MISSED" },
  );
});

test("expected delete helper supports an explicit cancel and never accepts an unexpected dialog", async () => {
  const page = new FakePage();
  const cancellation = dialog();
  const result = await withExpectedDeleteConfirmation(page, () => page.emitDialog(cancellation), { decision: "dismiss" });
  assert.equal(result.decision, "dismiss");
  assert.equal(cancellation.dismissed, true);
  const unexpected = dialog({ type: "alert", message: "unexpected" });
  await assert.rejects(
    withExpectedDeleteConfirmation(page, () => page.emitDialog(unexpected)),
    { code: "FROZEN_DELETE_DIALOG_EXPECTATION_MISSED" },
  );
  assert.equal(unexpected.dismissed, true);
});

test("expected delete helper waits for asynchronous handling and propagates its errors", async () => {
  const page = new FakePage();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const confirmation = dialog({ acceptGate: gate });
  const pending = withExpectedDeleteConfirmation(page, () => {
    page.emitDialog(confirmation);
    setTimeout(release, 5);
  }, { targetText: "副本" });
  const result = await pending;
  assert.equal(result.dialog.expected, true);
  assert.equal(confirmation.accepted, true);

  const acceptError = new Error("accept failed");
  await assert.rejects(
    withExpectedDeleteConfirmation(page, () => page.emitDialog(dialog({ acceptError })), { targetText: "副本" }),
    acceptError,
  );
  await assert.rejects(
    withExpectedDeleteConfirmation(page, () => page.emitDialog(dialog({ message: "确定删除“另一个目标”及其全部内容吗？" })), { targetText: "副本" }),
    { code: "FROZEN_DELETE_DIALOG_EXPECTATION_MISSED" },
  );
  await assert.rejects(
    withExpectedDeleteConfirmation(page, () => page.emitDialog(dialog({
      message: "确定删除“副本的另一个版本”及其全部内容吗？",
    })), { targetText: "副本" }),
    { code: "FROZEN_DELETE_DIALOG_EXPECTATION_MISSED" },
  );
});
