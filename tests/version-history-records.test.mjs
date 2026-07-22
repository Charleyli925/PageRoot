import assert from "node:assert/strict";
import test from "node:test";

import {
  versionAuditCollections,
} from "../app/lib/version-audit-records.js";

test("v3 top-level Version archive is authoritative for history records", () => {
  const comment = {
    commentId: "comment_history",
    createdAt: "2026-07-18T06:02:03.000Z",
    text: "保留这条可追溯评论",
    target: {
      targetId: "target_history",
      label: "历史标题",
      level: "subregion",
      selector: "main > h1",
    },
  };
  const editEvent = {
    eventId: "edit_history",
    createdAt: "2026-07-18T06:01:02.000Z",
    revision: 3,
    kind: "text",
    before: "旧标题",
    after: "新标题",
    target: comment.target,
  };
  const result = versionAuditCollections(
    {
      annotations: {
        schemaVersion: "3.0.0",
        comments: [comment],
        editEvents: [editEvent],
      },
    },
    {
      annotations: {
        comments: [{ commentId: "stale_comment" }],
        editEvents: [{ eventId: "stale_edit" }],
      },
    },
  );

  assert.deepEqual(result.comments, [comment]);
  assert.deepEqual(result.editEvents, [editEvent]);
});

test("empty v3 archives remain empty", () => {
  const result = versionAuditCollections(
    {
      annotations: {
        schemaVersion: "3.0.0",
        comments: [],
        editEvents: [],
      },
    },
    {
      comments: [{ commentId: "ignored_comment" }],
      changeEvents: [{ eventId: "ignored_edit" }],
    },
  );

  assert.deepEqual(result, { comments: [], editEvents: [] });
});

test("non-v3 archive shapes are not read as history", () => {
  assert.deepEqual(
    versionAuditCollections(
      {
        annotations: {
          schemaVersion: "2.0.0",
          comments: [{ commentId: "ignored_comment" }],
          editEvents: [{ eventId: "ignored_edit" }],
        },
      },
    ),
    { comments: [], editEvents: [] },
  );
});
