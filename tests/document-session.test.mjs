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
  assert.equal(session.canvasGeneration, 0);
});

test("authoritative source publication replaces bytes and Hash in one generation", () => {
  const session = new DocumentSession({
    html: "<main>old</main>",
    sourceSha256: "sha256:old",
  });
  const observed = [];
  session.setObserver((snapshot) => observed.push(snapshot));

  const snapshot = session.publishAuthority({
    html: "<main>new</main>",
    sourceSha256: "sha256:new",
    editRevision: 7,
    lastPersistedRevision: 7,
    persistState: "idle",
    persistError: "",
    pendingWrite: null,
  });

  assert.equal(observed.length, 1);
  assert.equal(snapshot.html, "<main>new</main>");
  assert.equal(snapshot.sourceSha256, "sha256:new");
  assert.equal(snapshot.canvasGeneration, 1);
  assert.equal(session.pendingWrite, null);
});

test("canvas recovery advances only the disposable render generation", () => {
  const session = new DocumentSession({
    html: "<main>same</main>",
    sourceSha256: "sha256:same",
  });
  const before = session.snapshot;

  const after = session.reloadCanvas();

  assert.equal(after.canvasGeneration, before.canvasGeneration + 1);
  assert.equal(after.html, before.html);
  assert.equal(after.sourceSha256, before.sourceSha256);
  assert.equal(after.editRevision, before.editRevision);
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
  assert.equal(session.canvasGeneration, 1);
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
