import assert from "node:assert/strict";
import test from "node:test";

import { createElementTextLocator } from "../app/lib/comment-text-locator.js";
import { buildSourceIndex } from "../app/lib/source-patch-core.js";

test("selected text persists as element-relative decoded offsets and affinity", () => {
  const html = `<p data-pageroot-id="pr1_11111111111141118111111111111111">开头<strong data-pageroot-id="pr1_22222222222242229222222222222222">中间</strong>结尾</p>`;
  const index = buildSourceIndex(html);
  const paragraph = index.byPagerootId.get("pr1_11111111111141118111111111111111");
  const textNodes = index.textNodes.filter((node) => {
    let current = node;
    while (current?.parentId) {
      if (current.parentId === paragraph.nodeId) return true;
      current = index.byNodeId.get(current.parentId);
    }
    return false;
  });
  assert.deepEqual(textNodes.map((node) => node.value), ["开头", "中间", "结尾"]);
  const locator = createElementTextLocator(index, {
    target: { nodeId: paragraph.nodeId },
    segments: [
      { textNodeId: textNodes[0].nodeId, startOffset: 1, endOffset: 2 },
      { textNodeId: textNodes[1].nodeId, startOffset: 0, endOffset: 2 },
      { textNodeId: textNodes[2].nodeId, startOffset: 0, endOffset: 1 },
    ],
    text: "头中间结",
    direction: "backward",
  });
  assert.deepEqual(locator, {
    quote: "头中间结",
    startOffset: 1,
    endOffset: 5,
    affinity: "backward",
  });
});

test("selected text locator fails closed when source segments and quote disagree", () => {
  const html = `<p data-pageroot-id="pr1_11111111111141118111111111111111">可靠文字</p>`;
  const index = buildSourceIndex(html);
  const paragraph = index.byPagerootId.get("pr1_11111111111141118111111111111111");
  const textNode = index.textNodes[0];
  assert.equal(createElementTextLocator(index, {
    target: { nodeId: paragraph.nodeId },
    segments: [{ textNodeId: textNode.nodeId, startOffset: 0, endOffset: 2 }],
    text: "错误",
    direction: "forward",
  }), null);
});
