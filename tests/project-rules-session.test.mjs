import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectRulesSession,
} from "../app/application/project-rules-session.js";

const CONTEXT = Object.freeze({
  epoch: 3,
  projectId: "project_rules",
  documentId: "document_rules",
  sourcePath: "/tmp/rules.html",
});

test("project rules session owns working-copy and save acknowledgement facts without Bridge IO", () => {
  const session = new ProjectRulesSession();
  const snapshots = [];
  const unsubscribe = session.subscribe((snapshot) => snapshots.push(snapshot));

  const read = session.beginOpen(CONTEXT);
  assert.ok(read);
  assert.equal(session.snapshot.loading, true);
  assert.equal(session.completeOpen(read, { content: "# Original" }), true);
  assert.equal(session.snapshot.savedContent, "# Original");

  assert.equal(session.updateContent("# Updated"), true);
  const save = session.beginSave();
  assert.ok(save);
  assert.equal(session.snapshot.saving, true);
  assert.equal(session.updateContent("# Updated again"), true);
  assert.equal(session.completeSave(save), true);

  assert.equal(session.snapshot.content, "# Updated again");
  assert.equal(session.snapshot.savedContent, "# Updated");
  assert.equal(session.inspect().state, "pending");
  assert.ok(snapshots.length >= 5);
  unsubscribe();
});

test("project rules composition fences explicit restore and retires late input", () => {
  const target = {};
  const session = new ProjectRulesSession();
  const read = session.beginOpen(CONTEXT);
  assert.ok(read);
  session.completeOpen(read, { content: "saved" });
  session.updateContent("draft");
  const compositionEpoch = session.beginComposition(target, "draft");
  assert.equal(typeof compositionEpoch, "number");
  session.updateContent("marked text");

  assert.equal(session.inspect().state, "pending");
  const restore = session.restore();
  assert.deepEqual(restore, {
    compositionEpoch,
    editorGeneration: 1,
  });
  assert.equal(session.snapshot.content, "saved");
  assert.equal(session.updateContent("late marked text"), false);
  assert.equal(session.settleRestore(compositionEpoch), true);
  assert.equal(session.snapshot.content, "saved");
  assert.equal(session.snapshot.compositionActive, false);
});

test("late project-rule reads and saves cannot replace a newer editor context", () => {
  const session = new ProjectRulesSession();
  const firstRead = session.beginOpen(CONTEXT);
  assert.ok(firstRead);
  const secondContext = {
    ...CONTEXT,
    epoch: 4,
    sourcePath: "/tmp/second.html",
  };
  const secondRead = session.beginOpen(secondContext);
  assert.ok(secondRead);

  assert.equal(session.completeOpen(secondRead, { content: "second" }), true);
  assert.equal(session.completeOpen(firstRead, { content: "stale" }), false);
  assert.equal(session.snapshot.content, "second");

  session.updateContent("second draft");
  const save = session.beginSave();
  assert.ok(save);
  const thirdRead = session.beginOpen({
    ...CONTEXT,
    epoch: 5,
    sourcePath: "/tmp/third.html",
  });
  assert.ok(thirdRead);
  assert.equal(session.completeSave(save), false);
  assert.equal(session.completeOpen(thirdRead, { content: "third" }), true);
  assert.equal(session.snapshot.content, "third");
});
