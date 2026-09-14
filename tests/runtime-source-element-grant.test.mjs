import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoundSourceElementProof,
  grantEditorCreatedSourceElements,
  revokeRemovedSourceElements,
  sealEditorCreatedSourceElements,
} from "../app/components/html-canvas-source-authority.js";
import { buildSourceIndex } from "../app/lib/source-index.js";

const ids = {
  html: "pr1_00000000000040008000000000000001",
  head: "pr1_00000000000040008000000000000002",
  body: "pr1_00000000000040008000000000000004",
  created: "pr1_0000000000004000800000000000000d",
};

const html = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head><body data-pageroot-id="${ids.body}"><p data-pageroot-id="${ids.created}">New</p></body></html>`;

function createAuthority({ generation = 7, executionId = "exec_grant" } = {}) {
  return {
    elementGeneration: generation,
    executionId,
    elements: new WeakSet(),
    pagerootIds: new WeakMap(),
  };
}

function createSurface(elements) {
  const byId = new Map(elements.map((element) => [element.id, element.node]));
  const documentNode = {
    querySelectorAll(selector) {
      const match = /data-pageroot-id="([^"]+)"/.exec(selector);
      const matches = [];
      if (match) {
        for (const element of elements) {
          if (element.node.getAttribute("data-pageroot-id") === match[1]) matches.push(element.node);
        }
      }
      return matches;
    },
  };
  for (const element of elements) {
    element.node.ownerDocument = documentNode;
  }
  return { documentNode, byId };
}

function createNode({ id, tag = "p", connected = true, extraId = null }) {
  const attrs = { "data-pageroot-id": extraId || id };
  return {
    id,
    node: {
      nodeType: 1,
      localName: tag,
      ownerDocument: null,
      isConnected: connected,
      getAttribute(name) {
        return attrs[name] ?? null;
      },
      setAttribute(name, value) {
        attrs[name] = value;
      },
      removeAttribute(name) {
        delete attrs[name];
      },
    },
  };
}

function grant(options) {
  const created = options.createdElements || [];
  return grantEditorCreatedSourceElements({
    sourceIndex: buildSourceIndex(html),
    expectedGeneration: 7,
    expectedExecutionId: "exec_grant",
    markerAttribute: "data-edit-runtime-source",
    creationTicket: sealEditorCreatedSourceElements(created),
    ...options,
  });
}

test("editor-created unique nodes can be granted once", () => {
  const created = createNode({ id: ids.created });
  const { documentNode } = createSurface([created]);
  const authority = createAuthority();
  assert.deepEqual(grant({
    authority,
    documentNode,
    createdElements: [created.node],
    allowedElementIds: [ids.created],
  }), { ok: true });
  assert.equal(authority.elements.has(created.node), true);
  assert.equal(created.node.getAttribute("data-edit-runtime-source"), ids.created);
  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [created.node],
    allowedElementIds: [ids.created],
  }).reason, "duplicate-grant");
});

test("forged IDs, stale frames, disconnected nodes and incomplete sets fail closed", () => {
  const created = createNode({ id: ids.created });
  const { documentNode } = createSurface([created]);
  const authority = createAuthority();

  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [created.node],
    allowedElementIds: ["pr1_000000000000400080000000000000ff"],
  }).reason, "created-identity-untrusted");

  assert.equal(grant({
    authority: createAuthority({ generation: 99 }),
    documentNode,
    createdElements: [created.node],
    allowedElementIds: [ids.created],
  }).reason, "stale-frame");

  const disconnected = createNode({ id: ids.created, connected: false });
  const disconnectedSurface = createSurface([disconnected]);
  assert.equal(grant({
    authority,
    documentNode: disconnectedSurface.documentNode,
    createdElements: [disconnected.node],
    allowedElementIds: [ids.created],
  }).reason, "created-node-invalid");

  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [created.node],
    allowedElementIds: [ids.created, ids.body],
  }).reason, "grant-set-incomplete");
});

test("author-generated clones with a legal ID cannot steal the grant", () => {
  const created = createNode({ id: ids.created });
  const authorClone = createNode({ id: "author", extraId: ids.created });
  const { documentNode } = createSurface([created, authorClone]);
  const authority = createAuthority();
  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [authorClone.node],
    allowedElementIds: [ids.created],
  }).reason, "created-identity-untrusted");
});

test("a unique author clone cannot receive a grant reserved for the pre-connect node", () => {
  const editorOriginal = createNode({ id: ids.created, connected: false });
  const authorClone = createNode({ id: "author", extraId: ids.created });
  const { documentNode } = createSurface([authorClone]);
  const authority = createAuthority();
  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [authorClone.node],
    allowedElementIds: [ids.created],
    creationTicket: sealEditorCreatedSourceElements([editorOriginal.node]),
  }).reason, "created-node-invalid");
  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [authorClone.node],
    allowedElementIds: [ids.created],
    creationTicket: null,
  }).reason, "created-node-invalid");
  editorOriginal.node.ownerDocument = documentNode;
  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [editorOriginal.node],
    allowedElementIds: [ids.created],
    creationTicket: sealEditorCreatedSourceElements([editorOriginal.node]),
  }).reason, "created-node-invalid");
});

test("bound source proof keeps the before-index after the live index advances", () => {
  const created = createNode({ id: ids.created });
  const { documentNode } = createSurface([created]);
  const authority = createAuthority();
  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [created.node],
    allowedElementIds: [ids.created],
  }).ok, true);
  const beforeIndex = buildSourceIndex(html);
  const afterIndex = buildSourceIndex(
    html.replace(`<p data-pageroot-id="${ids.created}">New</p>`, ""),
  );
  const beforeProof = createBoundSourceElementProof({
    authority,
    sourceIndex: beforeIndex,
    expectedGeneration: 7,
    expectedExecutionId: "exec_grant",
    markerAttribute: "data-edit-runtime-source",
  });
  const afterProof = createBoundSourceElementProof({
    authority,
    sourceIndex: afterIndex,
    expectedGeneration: 7,
    expectedExecutionId: "exec_grant",
    markerAttribute: "data-edit-runtime-source",
  });
  assert.equal(beforeProof(created.node), true);
  assert.equal(afterProof(created.node), false);
});

test("revoking a deleted node does not restore later author reinsertion", () => {
  const created = createNode({ id: ids.created });
  const { documentNode } = createSurface([created]);
  const authority = createAuthority();
  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [created.node],
    allowedElementIds: [ids.created],
  }).ok, true);
  revokeRemovedSourceElements({
    authority,
    removedElements: [created.node],
    markerAttribute: "data-edit-runtime-source",
  });
  assert.equal(authority.elements.has(created.node), false);
  created.node.isConnected = true;
  assert.equal(grant({
    authority,
    documentNode,
    createdElements: [created.node],
    allowedElementIds: [ids.created],
  }).ok, true);
});
