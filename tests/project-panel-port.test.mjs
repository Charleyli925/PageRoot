import assert from "node:assert/strict";
import test from "node:test";

import { createProjectPanelPort } from "../app/workbench/project-panel-port.js";

test("project panel port sequences rules-open and editor-restore presentation intents", () => {
  const port = createProjectPanelPort();
  let publications = 0;
  let settled = 0;
  const unsubscribe = port.subscribe(() => {
    publications += 1;
  });

  port.requestOpenRules();
  assert.equal(port.getSnapshot().openRulesRevision, 1);

  port.requestEditorRestore(() => {
    settled += 1;
  });
  const request = port.getSnapshot().editorRestoreRequest;
  assert.ok(request);
  assert.equal(port.settleEditorRestore(request.requestId), true);
  assert.equal(settled, 1);
  assert.equal(port.getSnapshot().editorRestoreRequest, null);
  assert.equal(publications, 3);

  unsubscribe();
});

test("project panel port settles immediately when no panel owns the editor", () => {
  const port = createProjectPanelPort();
  let settled = 0;
  port.requestEditorRestore(() => {
    settled += 1;
  });
  assert.equal(settled, 1);
  assert.equal(port.getSnapshot().editorRestoreRequest, null);
});
