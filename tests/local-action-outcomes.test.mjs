import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_USER_ACTION_KINDS,
  runLocalUserAction,
} from "../app/application/local-action-outcomes.js";

const OLD_LOCAL_RETRY_DELAY_MS = 180;

function waitFor(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

test("each local side effect runs once per user intent and leaves a visible recovery path", async () => {
  assert.deepEqual(LOCAL_USER_ACTION_KINDS, [
    "show-source-in-folder",
    "open-source-in-browser",
    "open-project-records",
    "reveal-request-folder",
    "reveal-ai-task",
    "reveal-version-file",
  ]);

  for (const kind of LOCAL_USER_ACTION_KINDS) {
    const firstFailure = new Error(`${kind} failed`);
    const ui = {
      projectAvailable: true,
      actionEnabled: true,
      visibleError: "",
      completed: false,
    };
    let calls = 0;
    const invoke = async () => {
      calls += 1;
      if (calls === 1) throw firstFailure;
      return { opened: true };
    };

    const first = await runLocalUserAction({
      kind,
      invoke,
      onFailure: (cause) => {
        assert.strictEqual(cause, firstFailure);
        ui.visibleError = `${kind} 暂时无法完成，请重试。`;
      },
    });
    assert.equal(first.status, "failed");
    assert.strictEqual(first.cause, firstFailure);
    assert.equal(calls, 1, `${kind} must issue one call for one click`);
    assert.match(ui.visibleError, /请重试/u);
    assert.equal(ui.projectAvailable, true);
    assert.equal(ui.actionEnabled, true);

    // Wait longer than the retired 180ms delay: failure must not replay itself.
    await waitFor(OLD_LOCAL_RETRY_DELAY_MS + 40);
    assert.equal(calls, 1, `${kind} must not retry after the first failure`);

    const second = await runLocalUserAction({
      kind,
      invoke,
      onSuccess: () => {
        ui.completed = true;
        ui.visibleError = "";
      },
    });
    assert.equal(second.status, "succeeded");
    assert.equal(calls, 2, `${kind} may run again only after a new user click`);
    assert.equal(ui.completed, true);
    assert.equal(ui.visibleError, "");
  }
});

test("local action execution rejects unknown kinds and invalid handlers before side effects", async () => {
  let calls = 0;
  await assert.rejects(
    () => runLocalUserAction({
      kind: "unknown",
      invoke: async () => { calls += 1; },
    }),
    /Unknown local user action/u,
  );
  await assert.rejects(
    () => runLocalUserAction({
      kind: "show-source-in-folder",
      invoke: null,
    }),
    /requires an invoke function/u,
  );
  assert.equal(calls, 0);
});
