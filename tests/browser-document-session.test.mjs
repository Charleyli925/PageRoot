import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { BrowserDocumentSession } from "../app/application/browser-document-session.js";
import { createBrowserFileTabIdentity } from "../app/application/browser-file-tab-identity.js";

const SHA_A = `sha256:${"a".repeat(64)}`;
const browserSha256 = async (value) => (
  `sha256:${createHash("sha256").update(value).digest("hex")}`
);

test("real browser Hash shape crosses identity creation and in-memory retention", async () => {
  const html = "<!doctype html><title>Real Hash</title>";
  const sourceSha256 = await browserSha256(html);
  const identity = await createBrowserFileTabIdentity({
    name: "real-hash.html",
    size: Buffer.byteLength(html),
    lastModified: 1_787_000_000_000,
    sourceSha256,
    sha256: browserSha256,
  });
  const session = new BrowserDocumentSession();
  session.retain({
    ...identity,
    name: "real-hash.html",
    sourcePath: null,
    html,
    sha256: sourceSha256,
  });
  assert.equal(session.resolve(identity.projectId, identity.documentId).sha256, sourceSha256);
  assert.match(sourceSha256, /^sha256:[a-f0-9]{64}$/u);
});

test("browser documents retain frozen in-memory Source and Hash authority only", () => {
  const session = new BrowserDocumentSession();
  const project = {
    projectId: "project_browser_a",
    documentId: "doc_browser_a",
    name: "A.html",
    sourcePath: null,
    html: "<h1>A</h1>",
    sha256: SHA_A,
  };
  session.retain(project);
  project.html = "mutated";
  project.sha256 = `sha256:${"b".repeat(64)}`;
  assert.deepEqual(session.resolve(project.projectId, project.documentId), {
    projectId: "project_browser_a",
    documentId: "doc_browser_a",
    name: "A.html",
    sourcePath: null,
    html: "<h1>A</h1>",
    sha256: SHA_A,
  });
  assert.equal(Object.isFrozen(session.resolve(project.projectId, project.documentId)), true);
  assert.throws(() => session.retain({
    ...project,
    html: "raw-hash",
    sha256: "c".repeat(64),
  }), /frozen identity, HTML and Hash/u);
});

test("browser document backing is identity-deduplicated and has no tab-count capacity", () => {
  const session = new BrowserDocumentSession();
  for (let index = 0; index < 512; index += 1) {
    session.retain({
      projectId: `project_browser_${index}`,
      documentId: `doc_browser_${index}`,
      name: `${index}.html`,
      sourcePath: null,
      html: `<p>${index}</p>`,
      sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
    });
  }
  assert.equal(session.size, 512);
  session.retain({
    projectId: "project_browser_1",
    documentId: "doc_browser_1",
    name: "1.html",
    sourcePath: null,
    html: "<p>new</p>",
    sha256: `sha256:${"f".repeat(64)}`,
  });
  assert.equal(session.size, 512);
  assert.equal(session.resolve("project_browser_1", "doc_browser_1").html, "<p>new</p>");
});

test("a failed replacement can restore the exact prior browser authority", () => {
  const session = new BrowserDocumentSession();
  const identity = {
    projectId: "project_browser_a",
    documentId: "doc_browser_a",
    name: "A.html",
    sourcePath: null,
  };
  session.retain({ ...identity, html: "A", sha256: `sha256:${"a".repeat(64)}` });
  const authority = session.retain({
    ...identity,
    html: "B",
    sha256: `sha256:${"b".repeat(64)}`,
  });
  assert.equal(session.resolve(identity.projectId, identity.documentId).html, "B");
  assert.equal(session.restore(authority), true);
  assert.equal(session.resolve(identity.projectId, identity.documentId).html, "A");
});
