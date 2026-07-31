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

test("project rules session owns load, edit, save, and unknown-outcome reconciliation", async () => {
  let persisted = "# Original";
  let rejectAfterWrite = true;
  const session = new ProjectRulesSession({
    bridgeClient: {
      async projectFile() {
        return { content: persisted };
      },
      async updateProjectFile({ content }) {
        persisted = content;
        if (rejectAfterWrite) {
          rejectAfterWrite = false;
          throw new Error("response lost");
        }
      },
    },
  });

  assert.equal(await session.open(CONTEXT), true);
  assert.equal(session.snapshot.savedContent, "# Original");
  assert.equal(session.updateContent("# Updated"), true);
  assert.equal(session.inspect().state, "pending");
  assert.equal(await session.save(), true);
  assert.equal(session.snapshot.content, "# Updated");
  assert.equal(session.snapshot.savedContent, "# Updated");
  assert.equal(session.inspect().state, "resolved");
});

test("project rules composition fences autosave and explicit restore retires late input", async () => {
  const target = {};
  const session = new ProjectRulesSession({
    bridgeClient: {
      async projectFile() {
        return { content: "saved" };
      },
      async updateProjectFile() {},
    },
  });
  await session.open(CONTEXT);
  session.updateContent("draft");
  const compositionEpoch = session.beginComposition(target, "draft");
  session.updateContent("marked text");

  assert.equal(await session.save(), false);
  assert.equal(session.inspect().state, "pending");
  assert.equal(session.restore(), compositionEpoch);
  assert.equal(session.snapshot.content, "saved");
  assert.equal(session.snapshot.editorGeneration, 1);
  assert.equal(session.updateContent("late marked text"), false);
  assert.equal(session.settleRestore(compositionEpoch), true);
  assert.equal(session.snapshot.content, "saved");
});

test("late project-rule reads cannot replace the next project", async () => {
  let releaseFirst;
  const firstRead = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const session = new ProjectRulesSession({
    bridgeClient: {
      async projectFile(sourcePath) {
        if (sourcePath === CONTEXT.sourcePath) return firstRead;
        return { content: "second" };
      },
      async updateProjectFile() {},
    },
  });

  const firstOpen = session.open(CONTEXT);
  const secondContext = {
    ...CONTEXT,
    epoch: 4,
    sourcePath: "/tmp/second.html",
  };
  assert.equal(await session.open(secondContext), true);
  releaseFirst({ content: "stale" });
  assert.equal(await firstOpen, false);
  assert.equal(session.snapshot.content, "second");
});
