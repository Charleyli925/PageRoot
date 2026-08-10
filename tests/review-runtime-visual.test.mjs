import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  acceptRuntimeVisualSnapshots,
  changedReviewRuntimeVisualCandidateKeys,
  mergeReviewRuntimeVisualChanges,
} from "../app/lib/review-runtime-visual.js";
import { RUNTIME_VISUAL_CONTRACT } from "../app/domain/runtime-visual-contract.js";

const PNG = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==",
  "base64",
));
const CHANGED_PNG = new Uint8Array(PNG);
CHANGED_PNG[CHANGED_PNG.length - 1] ^= 1;

function pngWithDimensions(width, height, byteLength = PNG.byteLength) {
  const png = new Uint8Array(Math.max(byteLength, PNG.byteLength));
  png.set(PNG);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return png;
}

function hash(bytes) {
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

function snapshot(key, pngBytes = PNG, overrides = {}) {
  return {
    key,
    state: "captured",
    pngSha256: hash(pngBytes),
    width: 1,
    height: 1,
    layoutWidth: 1,
    layoutHeight: 1,
    byteLength: pngBytes.byteLength,
    pngBytes: new Uint8Array(pngBytes),
    ...overrides,
  };
}

function unavailable(key) {
  return {
    key,
    state: "unavailable",
    pngSha256: "",
    width: 0,
    height: 0,
    layoutWidth: 0,
    layoutHeight: 0,
    byteLength: 0,
    pngBytes: new Uint8Array(),
  };
}

test("runtime snapshots accept only bounded declared PNG results", () => {
  const allowed = new Set(["runtime-host-1"]);
  const accepted = acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-1"),
  ], allowed);
  assert.equal(accepted?.length, 1);
  assert.equal(accepted?.[0].pngSha256, hash(PNG));
  assert.notEqual(accepted?.[0].pngBytes, PNG, "accepted bytes must be copied");
  assert.equal(acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-2"),
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), extra: true },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), pngSha256: hash(CHANGED_PNG) },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), width: 2 },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), layoutWidth: 0 },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    unavailable("runtime-host-1"),
  ], allowed)?.[0].state, "unavailable");
  assert.equal(acceptRuntimeVisualSnapshots(
    [],
    new Set(Array.from({ length: 33 }, (_, index) => `runtime-host-${index + 1}`)),
  ), null);
});

test("trusted runtime snapshot parser fails closed for hostile >2MB and >4096 results", () => {
  const allowed = new Set(["runtime-host-1"]);
  const { pngBytes, pngDimension } = RUNTIME_VISUAL_CONTRACT.pageBudget;
  const overByteLimit = pngWithDimensions(1, 1, pngBytes + 1);
  const overWidthLimit = pngWithDimensions(pngDimension + 1, 1);
  const overHeightLimit = pngWithDimensions(1, pngDimension + 1);

  assert.equal(acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-1", overByteLimit),
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-1", overWidthLimit, { width: pngDimension + 1 }),
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-1", overHeightLimit, { height: pngDimension + 1 }),
  ], allowed), null);
});

test("runtime comparison uses one before/after PNG pair and fails closed", () => {
  const candidates = [{ key: "runtime-host-1" }];
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1")],
  }), []);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
  }), ["runtime-host-1"]);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", PNG, { layoutWidth: 2 })],
  }), ["runtime-host-1"]);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [unavailable("runtime-host-1")],
  }), []);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
  }), []);
});

test("runtime visual merge reuses outline metadata but preserves one marker per candidate", () => {
  const documents = {
    changes: [{
      id: "change-1",
      label: "核心结论",
      helper: "文本调整",
      types: ["text"],
      beforePresent: true,
      afterPresent: true,
    }],
    outline: [
      {
        id: "outline-1",
        group: "页面",
        label: "核心结论",
        helper: "文本调整",
        changeId: "change-1",
        types: ["text"],
      },
      {
        id: "outline-2",
        group: "页面",
        label: "图表区",
        helper: "本轮未修改",
        types: [],
      },
    ],
    runtimeVisualCandidates: [
      {
        key: "runtime-host-1",
        outlineId: "outline-1",
        changeId: "change-1",
        label: "核心结论",
      },
      {
        key: "runtime-host-2",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图表区",
      },
      {
        key: "runtime-host-3",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图表区",
      },
    ],
  };
  const merged = mergeReviewRuntimeVisualChanges(documents, [
    "runtime-host-1",
    "runtime-host-2",
    "runtime-host-3",
  ]);
  assert.equal(merged.changes.length, 2);
  assert.deepEqual(merged.changes[0].types, ["text", "style"]);
  assert.equal(merged.changes[1].id, "runtime-change-outline-2");
  assert.deepEqual(merged.markers, [
    { candidateKey: "runtime-host-1", changeId: "change-1" },
    { candidateKey: "runtime-host-2", changeId: "runtime-change-outline-2" },
    { candidateKey: "runtime-host-3", changeId: "runtime-change-outline-2" },
  ]);
});
