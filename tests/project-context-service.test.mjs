import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySourceObservation,
  ProjectContextPolicyError,
  registeredCommandIdentity,
  registeredProjectRecord,
} from "../bridge/project-context-service.mjs";

test("registered mutation identity is complete or explicitly legacy", () => {
  assert.equal(registeredCommandIdentity({}), null);
  assert.deepEqual(
    registeredCommandIdentity({ projectId: "project_1", documentId: "doc_1" }),
    { projectId: "project_1", documentId: "doc_1" },
  );
  assert.throws(
    () => registeredCommandIdentity({ projectId: "project_1" }),
    (error) => error instanceof ProjectContextPolicyError
      && error.code === "INCOMPLETE_PROJECT_CONTEXT",
  );
});

test("registered project resolution follows IDs instead of a mutable path index", () => {
  const registry = {
    projects: {
      project_original: {
        documentId: "doc_original",
        sourcePath: "/tmp/report.html",
      },
      project_duplicate: {
        documentId: "doc_duplicate",
        sourcePath: "/tmp/report.html",
      },
    },
    documents: {
      doc_original: { projectId: "project_original" },
      doc_duplicate: { projectId: "project_duplicate" },
    },
    sources: {
      mutable_path_fingerprint: {
        projectId: "project_duplicate",
        documentId: "doc_duplicate",
      },
    },
  };
  const selected = registeredProjectRecord(registry, {
    projectId: "project_original",
    documentId: "doc_original",
  });
  assert.equal(selected.project, registry.projects.project_original);
  assert.equal(selected.document, registry.documents.doc_original);
});

test("a pending target hash proves PageRoot-owned atomic replacement", () => {
  assert.equal(classifySourceObservation({
    sourceSha256: "sha256:target",
    embeddedDocumentId: null,
    registeredDocumentId: "doc_1",
    projectCurrentHtmlSha256: "sha256:before",
    pendingTargetHtmlSha256: "sha256:target",
  }), "pageroot-pending-write");
  assert.equal(classifySourceObservation({
    sourceSha256: "sha256:external",
    embeddedDocumentId: null,
    registeredDocumentId: "doc_1",
    projectCurrentHtmlSha256: "sha256:before",
    pendingTargetHtmlSha256: "sha256:target",
  }), "external-replacement");
});
