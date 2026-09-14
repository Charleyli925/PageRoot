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

  async emitDialog(dialog) {
    await Promise.all([...this.#listeners].map((listener) => listener(dialog)));
  }
}

function dialog({ type = "confirm", message = "确定删除“副本”及其全部内容吗？" } = {}) {
  return {
    type: () => type,
    message: () => message,
    accepted: false,
    dismissed: false,
    async accept() { this.accepted = true; },
    async dismiss() { this.dismissed = true; },
  };
}

test("expected delete helper accepts one matching confirmation and cleans its listener", async () => {
  const page = new FakePage();
  const confirmation = dialog();
  const result = await withExpectedDeleteConfirmation(page, () => page.emitDialog(confirmation));
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
