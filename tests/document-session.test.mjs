import assert from "node:assert/strict";
import test from "node:test";

import { DocumentSession } from "../app/application/document-session.js";

test("document session owns source bytes, revisions and pending write", () => {
  const session = new DocumentSession({
    html: "<main>one</main>",
    sourceSha256: "sha256:one",
  });
  const revision = session.beginEdit("<main>two</main>");
  const write = { revision, html: session.html };
  session.setPendingWrite(write);
  session.setPersistence({ state: "queued", error: "" });

  assert.equal(revision, 1);
  assert.equal(session.html, "<main>two</main>");
  assert.equal(session.pendingWrite, write);
  assert.equal(session.snapshot.persistState, "queued");
});

test("document conflict rejects later edit revisions until reset", () => {
  const session = new DocumentSession({ html: "one" });
  session.beginEdit("two");
  session.setPersistence({ state: "conflict", error: "changed" });
  assert.equal(session.beginEdit("three"), 1);
  assert.equal(session.html, "two");

  session.reset({ html: "external", sourceSha256: "sha256:external" });
  assert.equal(session.persistState, "idle");
  assert.equal(session.pendingWrite, null);
  assert.equal(session.editRevision, 0);
});

test("document session clears only the matching flush promise", async () => {
  const session = new DocumentSession();
  const first = Promise.resolve(true);
  const second = Promise.resolve(false);
  session.setFlushPromise(first);
  assert.equal(session.clearFlushPromise(second), false);
  assert.equal(session.flushPromise, first);
  assert.equal(session.clearFlushPromise(first), true);
  assert.equal(session.flushPromise, null);
});
