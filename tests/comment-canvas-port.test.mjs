import assert from "node:assert/strict";
import test from "node:test";

import { createCommentCanvasPort } from "../app/workbench/comment-canvas-port.js";

test("comment canvas port publishes selection without storing comment facts", () => {
  const port = createCommentCanvasPort();
  const initial = port.getSnapshot();
  let notifications = 0;
  const unsubscribe = port.subscribe(() => {
    notifications += 1;
  });
  const selection = {
    id: "hero",
    label: "Hero",
    selector: "#hero",
    level: "element",
    tagName: "section",
    resolution: "exact",
    sourceAnchor: null,
  };

  port.setSelection(selection);
  assert.equal(port.getSnapshot().selection, selection);
  assert.equal(notifications, 1);
  port.setSelection(selection);
  assert.equal(notifications, 1);
  port.setSelection(null);
  assert.equal(notifications, 2);
  assert.notEqual(port.getSnapshot(), initial);

  unsubscribe();
  port.setSelection(selection);
  assert.equal(notifications, 2);
});
