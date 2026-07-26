import assert from "node:assert/strict";
import test from "node:test";

import {
  BridgeRequestError,
} from "../app/application/bridge-client.js";
import { DraftSession } from "../app/application/draft-session.js";

const context = {
  epoch: 4,
  projectId: "project_1",
  documentId: "document_1",
  sourcePath: "/tmp/page.html",
};

function authoritative(revision, extra = {}) {
  return {
    draftRevision: revision,
    comments: [],
    changeEvents: [],
    deletedCommentIds: [],
    appliedOperationIds: [],
    ...extra,
  };
}

test("draft session rebases a stale mutation and advances one authority", async () => {
  const writes = [];
  const events = [];
  const client = {
    async saveDraft(write) {
      writes.push(write);
      if (writes.length === 1) {
        throw new BridgeRequestError("stale", {
          status: 409,
          code: "DRAFT_REVISION_CONFLICT",
          details: {
            activeDraft: authoritative(6, {
              comments: [{
                commentId: "comment_server",
                text: "server",
                updatedAt: "2026-01-01T00:00:01.000Z",
              }],
            }),
          },
        });
      }
      return {
        ok: true,
        activeDraft: authoritative(7, {
          comments: write.comments,
          appliedOperationIds: [write.operationId],
        }),
      };
    },
    async workspace() {
      throw new Error("conflict response already carried authority");
    },
  };
  const session = new DraftSession({ bridgeClient: client });
  session.setObserver((event) => events.push(event));
  session.activate(context, 5);
  const snapshot = session.createSnapshot({
    comments: [{
      commentId: "comment_local",
      text: "local",
      updatedAt: "2026-01-01T00:00:02.000Z",
    }],
  });

  assert.equal(await session.drain(snapshot), true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].operationId, writes[1].operationId);
  assert.equal(writes[1].expectedDraftRevision, 6);
  assert.deepEqual(
    writes[1].comments.map((comment) => comment.commentId).sort(),
    ["comment_local", "comment_server"],
  );
  assert.equal(session.revision, 7);
  assert.equal(events.at(-1).type, "acknowledged");
});

test("draft session reconciles an unknown outcome without repeating the POST", async () => {
  let saveCount = 0;
  const client = {
    async saveDraft() {
      saveCount += 1;
      throw new BridgeRequestError("timeout", {
        outcome: "unknown",
      });
    },
    async workspace() {
      return {
        runtimeState: {
          draft: authoritative(11, {
            appliedOperationIds: [snapshot.operationId],
          }),
        },
      };
    },
  };
  const session = new DraftSession({ bridgeClient: client });
  session.activate(context, 10);
  const snapshot = session.createSnapshot({ comments: [] });

  assert.equal(await session.drain(snapshot), true);
  assert.equal(saveCount, 1);
  assert.equal(session.revision, 11);
});

test("a retired project cannot overwrite the next project's draft authority", async () => {
  let release;
  const client = {
    async saveDraft(write) {
      await new Promise((resolve) => {
        release = resolve;
      });
      return {
        ok: true,
        activeDraft: authoritative(write.expectedDraftRevision + 1, {
          appliedOperationIds: [write.operationId],
        }),
      };
    },
    async workspace() {
      return {};
    },
  };
  const events = [];
  const session = new DraftSession({ bridgeClient: client });
  session.setObserver((event) => events.push(event.type));
  session.activate(context, 3);
  const pending = session.drain(session.createSnapshot({ comments: [] }));
  await Promise.resolve();
  session.activate({
    ...context,
    epoch: 5,
    projectId: "project_2",
    documentId: "document_2",
    sourcePath: "/tmp/next.html",
  }, 20);
  release();

  assert.equal(await pending, false);
  assert.equal(session.revision, 20);
  assert.deepEqual(events, ["retired"]);
});

test("replacing authority resets revision even for the same project identity", () => {
  const session = new DraftSession({
    bridgeClient: {
      async saveDraft() {
        return {};
      },
      async workspace() {
        return {};
      },
    },
  });
  session.activate(context, 104);
  assert.deepEqual(session.context, context);
  assert.equal(Object.isFrozen(session.context), true);
  session.replaceAuthority(context, 0);
  assert.equal(session.revision, 0);
  assert.equal(session.inspect().pending, false);
  session.deactivate();
  assert.equal(session.context, null);
});

test("a final drain verifies an unchanged acknowledged draft without a write", async () => {
  let writes = 0;
  const client = {
    async saveDraft() {
      writes += 1;
      return {};
    },
    async workspace() {
      return {};
    },
  };
  const session = new DraftSession({ bridgeClient: client });
  session.activate(context, 106, authoritative(106, {
    comments: [{ commentId: "comment_1", text: "same" }],
  }));
  const snapshot = session.createSnapshot({
    comments: [{ commentId: "comment_1", text: "same" }],
  });

  assert.equal(await session.drain(snapshot), true);
  assert.equal(writes, 0);
  assert.equal(session.revision, 106);
});

test("an older in-flight failure cannot replace a newer pending aggregate", async () => {
  let rejectFirst;
  const writes = [];
  const client = {
    async saveDraft(write) {
      writes.push(write);
      if (writes.length === 1) {
        return new Promise((_resolve, reject) => {
          rejectFirst = reject;
        });
      }
      return {
        ok: true,
        activeDraft: authoritative(write.expectedDraftRevision + 1, {
          comments: write.comments,
          appliedOperationIds: [write.operationId],
        }),
      };
    },
    async workspace() {
      return {};
    },
  };
  const session = new DraftSession({ bridgeClient: client });
  session.activate(context, 12);
  const first = session.createSnapshot({
    operationId: "draftop_first_pending_0001",
    comments: [{ commentId: "comment_1", text: "older" }],
  });
  const firstDrain = session.drain(first);
  await Promise.resolve();
  const newer = session.createSnapshot({
    operationId: "draftop_newer_pending_0002",
    comments: [{ commentId: "comment_1", text: "newer" }],
  });
  session.queue(newer);
  rejectFirst(new Error("temporary write failure"));

  assert.equal(await firstDrain, false);
  assert.equal(session.inspect().pending, true);
  assert.equal(await session.drain(), true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].operationId, newer.operationId);
  assert.equal(writes[1].comments[0].text, "newer");
});
