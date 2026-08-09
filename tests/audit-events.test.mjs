import assert from "node:assert/strict";
import test from "node:test";

import {
  auditEventKey,
  removeAcknowledgedAuditEvents,
} from "../app/lib/audit-events.js";

test("autosave acknowledgement keeps a coalesced style event from a newer revision", () => {
  const revisionN = {
    eventId: "change_style_1",
    kind: "style",
    revision: 7,
  };
  const revisionNPlusOne = {
    ...revisionN,
    after: "#ffffff",
    revision: 8,
  };

  assert.notEqual(auditEventKey(revisionN), auditEventKey(revisionNPlusOne));
  assert.deepEqual(
    removeAcknowledgedAuditEvents(
      [revisionNPlusOne],
      [revisionN],
    ),
    [revisionNPlusOne],
  );
  assert.deepEqual(
    removeAcknowledgedAuditEvents(
      [revisionN, revisionNPlusOne],
      [revisionN],
    ),
    [revisionNPlusOne],
  );
});

test("audit acknowledgement rejects records without the v3 revision identity", () => {
  assert.throws(
    () => auditEventKey({ eventId: "change_missing_revision" }),
    /requires eventId and revision/,
  );
});
