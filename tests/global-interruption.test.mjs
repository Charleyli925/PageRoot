import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBAL_INTERRUPTION_KINDS,
  globalInterruptionPresentation,
} from "../app/lib/global-interruption.js";

test("unknown kinds cannot present a free-form interruption", () => {
  assert.equal(globalInterruptionPresentation(null), null);
  assert.equal(globalInterruptionPresentation({ kind: "made-up-toast" }), null);
  assert.ok(GLOBAL_INTERRUPTION_KINDS.includes("external-agent-may-still-run"));
});

test("allowlisted copy is owned by the catalog, not the caller", () => {
  const presented = globalInterruptionPresentation({
    kind: "handoff-recopy",
    succeeded: false,
  });
  assert.equal(presented?.title, "复制没有成功");
  assert.equal(presented?.actionId, null);
});
