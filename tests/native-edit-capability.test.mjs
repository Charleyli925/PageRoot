import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  NATIVE_EDIT_MODE,
  classifyNativeEditCapability,
  isNativeDirectEditRoot,
  isNativeEditableCapability,
} from "../app/lib/native-edit-capability.js";

function elementById(index, id) {
  return index.elements.find((element) => element.stableAttributes.id === id);
}

function safeRuntime(overrides = {}) {
  return {
    preflightComplete: true,
    sourceBacked: true,
    isConnected: true,
    mappingComplete: true,
    styleStable: true,
    layoutStable: true,
    selectionStable: true,
    observerReady: true,
    nativeEventDeliveryStable: true,
    authorMutationRisk: false,
    isSingleTextIsland: true,
    ...overrides,
  };
}

test("marks an inline-rich paragraph editable only after the complete live preflight", () => {
  const index = buildSourceIndex(`<p id="copy">甲<strong>乙</strong><em>丙</em></p>`);
  const paragraph = elementById(index, "copy");
  const beforePreflight = classifyNativeEditCapability(index, paragraph.nodeId);
  const ready = classifyNativeEditCapability(index, paragraph.nodeId, {
    runtime: safeRuntime(),
  });

  assert.equal(beforePreflight.mode, NATIVE_EDIT_MODE.SELECT_COMMENT);
  assert.equal(beforePreflight.code, "RUNTIME_PREFLIGHT_REQUIRED");
  assert.equal(ready.mode, NATIVE_EDIT_MODE.EDITABLE);
  assert.equal(ready.directlyEditable, true);
  assert.equal(ready.sourceBacked, true);
  assert.equal(isNativeEditableCapability(ready), true);
});

test("keeps br, structural atoms, and unproven divs on the select-and-comment path", () => {
  const index = buildSourceIndex(`
    <main>
      <p id="break">A<br>B</p>
      <p id="atom">A<img src=x>B</p>
      <div id="div">Text</div>
    </main>
  `);
  const runtime = safeRuntime();
  const hardBreak = classifyNativeEditCapability(
    index,
    elementById(index, "break").nodeId,
    { runtime },
  );
  const atom = classifyNativeEditCapability(
    index,
    elementById(index, "atom").nodeId,
    { runtime },
  );
  const div = classifyNativeEditCapability(
    index,
    elementById(index, "div").nodeId,
    { runtime: safeRuntime({ isSingleTextIsland: false }) },
  );

  assert.equal(hardBreak.mode, NATIVE_EDIT_MODE.SELECT_COMMENT);
  assert.equal(hardBreak.code, "SOURCE_STRUCTURE_HARD_BREAK_UNSUPPORTED");
  assert.equal(atom.mode, NATIVE_EDIT_MODE.SELECT_COMMENT);
  assert.equal(atom.code, "SOURCE_STRUCTURE_RANGE_UNSUPPORTED");
  assert.equal(div.mode, NATIVE_EDIT_MODE.SELECT_COMMENT);
  assert.equal(div.code, "TEXT_ISLAND_NOT_PROVEN");
  assert.match(hardBreak.userMessage, /选中文字并添加评论/u);
});

test("fails closed when an empty authored inline creates several anchors at one text offset", () => {
  const index = buildSourceIndex(`
    <main>
      <p id="visible-empty">A<span style="display:inline-block;width:20px"></span>B</p>
      <p id="nested-empty">A<strong><em></em></strong>B</p>
    </main>
  `);
  for (const id of ["visible-empty", "nested-empty"]) {
    const result = classifyNativeEditCapability(
      index,
      elementById(index, id).nodeId,
      { runtime: safeRuntime() },
    );
    assert.equal(result.mode, NATIVE_EDIT_MODE.SELECT_COMMENT);
    assert.equal(result.directlyEditable, false);
    assert.equal(result.code, "SOURCE_AMBIGUOUS_ZERO_LENGTH_BOUNDARY");
    assert.match(result.userMessage, /空的排版元素/u);
    assert.match(result.userMessage, /错误位置/u);
    assert.match(result.userMessage, /选中文字并添加评论/u);
    assert.equal(result.details.boundaries.length > 0, true);
  }
});

test("keeps authored comments out of native direct edit even when surrounding text matches", () => {
  const index = buildSourceIndex(`<p id="comment-boundary">A<!-- authored boundary -->B</p>`);
  const result = classifyNativeEditCapability(
    index,
    elementById(index, "comment-boundary").nodeId,
    { runtime: safeRuntime() },
  );

  assert.equal(result.mode, NATIVE_EDIT_MODE.SELECT_COMMENT);
  assert.equal(result.directlyEditable, false);
  assert.equal(result.code, "SOURCE_STRUCTURE_RANGE_UNSUPPORTED");
  assert.match(result.userMessage, /暂不支持直接改字/u);
  assert.match(result.userMessage, /选中文字并添加评论/u);
});

test("allows explicitly implemented structural features without weakening runtime gates", () => {
  const index = buildSourceIndex(`<p id="copy">A<br>B</p>`);
  const paragraph = elementById(index, "copy");
  const ready = classifyNativeEditCapability(index, paragraph.nodeId, {
    features: { hardBreak: true },
    runtime: safeRuntime(),
  });
  const unstable = classifyNativeEditCapability(index, paragraph.nodeId, {
    features: { hardBreak: true },
    runtime: safeRuntime({ styleStable: false }),
  });

  assert.equal(ready.mode, NATIVE_EDIT_MODE.EDITABLE);
  assert.equal(unstable.mode, NATIVE_EDIT_MODE.SELECT_COMMENT);
  assert.equal(unstable.code, "RUNTIME_NATIVE_EDIT_UNSAFE");
  assert.deepEqual(unstable.details.blockers, ["style-unstable"]);
});

test("requires an explicit proof that native editing events reach the authored host", () => {
  const index = buildSourceIndex(
    `<p id="copy">Old <span style="display: contents !important">event wrapper</span></p>`,
  );
  const paragraph = elementById(index, "copy");
  const missingProof = safeRuntime();
  delete missingProof.nativeEventDeliveryStable;

  for (const runtime of [
    safeRuntime({ nativeEventDeliveryStable: false }),
    missingProof,
  ]) {
    const result = classifyNativeEditCapability(index, paragraph.nodeId, { runtime });
    assert.equal(result.mode, NATIVE_EDIT_MODE.SELECT_COMMENT);
    assert.equal(result.directlyEditable, false);
    assert.equal(result.code, "RUNTIME_NATIVE_EDIT_UNSAFE");
    assert.deepEqual(
      result.details.blockers,
      ["native-editing-event-delivery-unstable"],
    );
  }
});

test("routes generated, cross-origin, Shadow DOM, and dedicated controls to comment-only", () => {
  const index = buildSourceIndex(`<main><p id="copy">A</p><textarea id="field">B</textarea></main>`);
  const paragraph = elementById(index, "copy");
  const textarea = elementById(index, "field");
  for (const override of [
    { generatedContent: true },
    { crossOrigin: true },
    { insideShadowRoot: true },
    { sourceBacked: false },
  ]) {
    const result = classifyNativeEditCapability(index, paragraph.nodeId, {
      runtime: safeRuntime(override),
    });
    assert.equal(result.mode, NATIVE_EDIT_MODE.COMMENT_ONLY);
    assert.equal(result.selectable, false);
  }
  const dedicated = classifyNativeEditCapability(index, textarea.nodeId, {
    runtime: safeRuntime(),
  });
  assert.equal(dedicated.mode, NATIVE_EDIT_MODE.COMMENT_ONLY);
  assert.equal(dedicated.code, "DEDICATED_EDITOR_REQUIRED");
});

test("uses a proved source-backed text island instead of a visual-tag allow-list", () => {
  const index = buildSourceIndex(`
    <main>
      <span id="badge">独立徽标</span>
      <button id="button" type="button">保存草稿</button>
      <summary id="summary">展开详情</summary>
      <odd-card id="custom">自定义元素文字</odd-card>
    </main>
  `);

  for (const id of ["badge", "summary", "custom"]) {
    const result = classifyNativeEditCapability(
      index,
      elementById(index, id).nodeId,
      { runtime: safeRuntime() },
    );
    assert.equal(result.mode, NATIVE_EDIT_MODE.EDITABLE, id);
    assert.equal(result.code, "NATIVE_EDITABLE", id);
    assert.equal(isNativeDirectEditRoot(elementById(index, id).tagName), true, id);
  }
  const button = classifyNativeEditCapability(
    index,
    elementById(index, "button").nodeId,
    { runtime: safeRuntime() },
  );
  assert.equal(button.mode, NATIVE_EDIT_MODE.COMMENT_ONLY);
  assert.equal(button.code, "DEDICATED_EDITOR_REQUIRED");
});

test("allows authored text beside pseudo content but not a pseudo-only empty host", () => {
  const index = buildSourceIndex(`
    <main>
      <p id="authored">真实文字</p>
      <p id="empty"></p>
    </main>
  `);
  const authored = classifyNativeEditCapability(
    index,
    elementById(index, "authored").nodeId,
    { runtime: safeRuntime({ pseudoContent: true }) },
  );
  const empty = classifyNativeEditCapability(
    index,
    elementById(index, "empty").nodeId,
    {
      features: { emptyHost: true },
      runtime: safeRuntime({ pseudoContent: true }),
    },
  );

  assert.equal(authored.mode, NATIVE_EDIT_MODE.EDITABLE);
  assert.equal(empty.mode, NATIVE_EDIT_MODE.COMMENT_ONLY);
  assert.equal(empty.code, "RUNTIME_CONTENT_NOT_DIRECTLY_EDITABLE");
});

test("fails closed instead of guessing when the source target is absent", () => {
  const index = buildSourceIndex(`<p>Text</p>`);
  const result = classifyNativeEditCapability(index, "missing", {
    runtime: safeRuntime(),
  });
  assert.equal(result.mode, NATIVE_EDIT_MODE.COMMENT_ONLY);
  assert.equal(result.code, "SOURCE_TARGET_ORPHANED");
  assert.equal(result.sourceBacked, false);
});
