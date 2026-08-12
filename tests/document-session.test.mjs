import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { DocumentSession } from "../app/application/document-session.js";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

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

test("document snapshot exposes only derived write and flush state", () => {
  const session = new DocumentSession({ html: "<main>source</main>" });
  const write = { revision: 1, html: session.html };
  session.setPendingWrite(write);
  session.setPersistence({ state: "queued" });
  assert.equal(session.snapshot.hasPendingWrite, true);
  assert.equal(session.snapshot.isFlushing, false);

  const flush = Promise.resolve(true);
  session.setFlushPromise(flush);
  assert.equal(session.snapshot.hasPendingWrite, true);
  assert.equal(session.snapshot.isFlushing, true);

  assert.equal(session.clearFlushPromise(flush), true);
  session.takePendingWrite();
  session.setPersistence({ state: "idle" });
  assert.equal(session.snapshot.hasPendingWrite, false);
  assert.equal(session.snapshot.isFlushing, false);
});

test("a stale canvas hash does not block a boundary whose exact bytes were safely persisted", async () => {
  const html = "<main>saved</main>";
  const sourceSha256 = sha256(html);
  const session = new DocumentSession({ html, sourceSha256 });
  session.update({
    editRevision: 4,
    lastPersistedRevision: 6,
  });
  let sourceReads = 0;

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    reportedSourceSha256: sha256("<main>stale canvas metadata</main>"),
    cutoffRevision: 4,
    hashHtml: async (value) => sha256(value),
    readSource: async () => {
      sourceReads += 1;
      throw new Error("the local acknowledgement is already sufficient");
    },
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.deepEqual(result, {
    ready: true,
    repaired: true,
    sourceSha256,
    lastModifiedAt: "",
  });
  assert.equal(sourceReads, 0);
});

test("a stale persisted projection is silently repaired from authoritative source bytes", async () => {
  const html = "<main>saved</main>";
  const sourceSha256 = sha256(html);
  const session = new DocumentSession({
    html,
    sourceSha256: sha256("<main>old</main>"),
  });
  session.update({ editRevision: 3, lastPersistedRevision: 2 });

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    cutoffRevision: 3,
    hashHtml: async (value) => sha256(value),
    readSource: async () => ({
      content: html,
      sha256: sourceSha256,
      lastModifiedAt: "2026-08-04T10:00:00.000Z",
    }),
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.deepEqual(result, {
    ready: true,
    repaired: true,
    sourceSha256,
    lastModifiedAt: "2026-08-04T10:00:00.000Z",
  });
  assert.equal(session.sourceSha256, sourceSha256);
  assert.equal(session.lastPersistedRevision, 3);
  assert.equal(session.persistState, "idle");
});

test("only confirmed authoritative divergence becomes a source conflict", async () => {
  const html = "<main>local</main>";
  const externalHtml = "<main>external</main>";
  const session = new DocumentSession({
    html,
    sourceSha256: sha256("<main>old</main>"),
  });
  session.update({ editRevision: 2, lastPersistedRevision: 1 });

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    cutoffRevision: 2,
    hashHtml: async (value) => sha256(value),
    readSource: async () => ({
      content: externalHtml,
      sha256: sha256(externalHtml),
    }),
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "source-diverged");
  assert.equal(result.confirmed, true);
  assert.equal(session.persistState, "conflict");
  assert.match(session.persistError, /其他操作修改/u);
});

test("a transient authoritative read failure stays recoverable and does not invent corruption", async () => {
  const html = "<main>local</main>";
  const session = new DocumentSession({
    html,
    sourceSha256: sha256("<main>old</main>"),
  });
  session.update({ editRevision: 2, lastPersistedRevision: 1 });

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    cutoffRevision: 2,
    hashHtml: async (value) => sha256(value),
    readSource: async () => {
      throw new Error("temporarily unavailable");
    },
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "source-unavailable");
  assert.equal(result.confirmed, false);
  assert.equal(session.persistState, "idle");
});

test("invalid authoritative content integrity is confirmed before recovery is escalated", async () => {
  const html = "<main>local</main>";
  const session = new DocumentSession({
    html,
    sourceSha256: sha256("<main>old</main>"),
  });
  session.update({ editRevision: 2, lastPersistedRevision: 1 });

  const result = await session.reconcilePersistedBoundary({
    frozenHtml: html,
    cutoffRevision: 2,
    hashHtml: async (value) => sha256(value),
    readSource: async () => ({
      content: "<main>damaged response</main>",
      sha256: sha256("<main>different bytes</main>"),
    }),
    isCurrent: () => true,
    acceptsSource: () => true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "source-integrity-failed");
  assert.equal(result.confirmed, true);
  assert.equal(session.persistState, "idle");
});
