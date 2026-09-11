import assert from "node:assert/strict";
import test from "node:test";

import {
  withRestoredElectronClipboard,
} from "./e2e/electron/helpers/clipboard-snapshot.mjs";

test("any non-empty clipboard blocks before the action or restore write", async () => {
  for (const formats of [["text/plain"], ["text/html", "text/plain"], ["NSStringPboardType"]]) {
    let evaluateCalls = 0;
    let actionCalled = false;
    const electronApp = {
      async evaluate() {
        evaluateCalls += 1;
        return formats;
      },
    };

    await assert.rejects(
      withRestoredElectronClipboard(electronApp, async () => {
        actionCalled = true;
      }),
      (error) => error?.code === "CLIPBOARD_FORMAT_UNSUPPORTED",
    );
    assert.equal(actionCalled, false);
    assert.equal(evaluateCalls, 1, "no restore evaluate may run after the preflight blocker");
  }
});
