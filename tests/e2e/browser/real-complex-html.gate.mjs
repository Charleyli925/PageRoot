import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  currentEditorFrame,
  documentToken,
  exportCurrentHtml,
  keyShortcut,
  replaceUniqueBytes,
  sha256,
} from "./pageroot-driver.mjs";

const repositoryRealHtmlPath = fileURLToPath(
  new URL("../../fixtures/native-dom/complex-layout.html", import.meta.url),
);
const realHtmlPath = process.env.PAGEROOT_REAL_HTML_PATH || repositoryRealHtmlPath;

function validatedRealHtmlPath() {
  if (!path.isAbsolute(realHtmlPath) || path.extname(realHtmlPath).toLowerCase() !== ".html") {
    throw new Error(`PAGEROOT_REAL_HTML_PATH must be an absolute .html path: ${realHtmlPath}`);
  }
  return realHtmlPath;
}

function firstByteDifference(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  let offset = 0;
  while (offset < limit && actual[offset] === expected[offset]) offset += 1;
  const start = Math.max(0, offset - 48);
  const end = Math.min(Math.max(actual.length, expected.length), offset + 128);
  return JSON.stringify({
    offset,
    actualLength: actual.length,
    expectedLength: expected.length,
    actual: actual.subarray(start, Math.min(actual.length, end)).toString("utf8"),
    expected: expected.subarray(start, Math.min(expected.length, end)).toString("utf8"),
  });
}

function escapeAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function loadRealHtml(page, sourcePath, source) {
  await page.goto("/");
  const name = path.basename(sourcePath);
  const fileInput = page.locator('input[type="file"][accept*=".html"]').first();
  await fileInput.waitFor({ state: "attached" });
  await fileInput.setInputFiles({ name, mimeType: "text/html", buffer: source });
  await page.getByText(name, { exact: true }).first().waitFor({ state: "visible" });

  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  await editor.waitFor({ state: "visible" });
  const editorHandle = await editor.elementHandle();
  await page.waitForFunction(
    (element) => element?.getAttribute("data-render-verified") === "true",
    editorHandle,
  );
  const iframe = editor.locator('iframe[title*="HTML"]');
  await iframe.waitFor({ state: "visible" });
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("The real HTML preview did not expose a same-origin edit frame.");
  await frame.waitForFunction(() => document.readyState === "complete" && Boolean(document.body));
  return { editor, iframe, frame };
}

async function waitForFreshFenceFrame(page, editor, previousDocumentToken) {
  await expect.poll(async () => {
    try {
      return await documentToken(page);
    } catch {
      return previousDocumentToken;
    }
  }, { timeout: 10_000 }).not.toBe(previousDocumentToken);
  await expect.poll(() => editor.getAttribute("data-render-verified"), {
    timeout: 10_000,
  }).toBe("true");
  return currentEditorFrame(page);
}

function uniqueLiteralForCandidate(source, text) {
  const normalized = text.trim();
  const codePoints = Array.from(normalized);
  for (const length of [12, 10, 8, 6, 4]) {
    if (codePoints.length < length) continue;
    const maxStart = Math.min(codePoints.length - length, 24);
    for (let start = 0; start <= maxStart; start += 1) {
      const token = codePoints.slice(start, start + length).join("");
      if (/\r|\n/u.test(token) || !token.trim()) continue;
      const bytes = Buffer.from(token, "utf8");
      const first = source.indexOf(bytes);
      if (first >= 0 && source.indexOf(bytes, first + bytes.length) < 0) {
        return { token, textOffset: text.indexOf(token) };
      }
    }
  }
  return null;
}

async function discoverEditableCandidate(frame, source) {
  const candidates = await frame.locator("[data-html-ai-source-node-id]").evaluateAll((elements) => {
    const preferredTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"]);
    const tagPriority = new Map([
      ["p", 0],
      ["h1", 1], ["h2", 1], ["h3", 1], ["h4", 1], ["h5", 1], ["h6", 1],
      ["li", 2],
      ["td", 3], ["th", 3],
    ]);
    const hasMotion = (element) => {
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        const nonZero = (value) => value.split(",").some((part) => parseFloat(part) > 0);
        if (nonZero(style.transitionDuration)
          || (style.animationName !== "none" && nonZero(style.animationDuration))) return true;
        current = current.parentElement;
      }
      return false;
    };
    const pseudoContent = (element) => ["::before", "::after"].some((pseudo) => {
      const content = getComputedStyle(element, pseudo).content;
      return Boolean(content && content !== "none" && content !== "normal" && content !== '""');
    });
    return elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        index,
        sourceId: element.getAttribute("data-html-ai-source-node-id"),
        tagName: element.localName,
        text: element.textContent || "",
        childElementCount: element.childElementCount,
        visible: rect.width > 2 && rect.height > 2
          && style.display !== "none" && style.visibility !== "hidden",
        preferredTag: preferredTags.has(element.localName),
        tagPriority: tagPriority.get(element.localName) ?? 9,
        horizontal: style.writingMode === "horizontal-tb",
        pseudoContent: pseudoContent(element),
        motion: hasMotion(element),
        forbiddenDescendant: Boolean(element.querySelector(
          "br,img,svg,math,canvas,iframe,input,textarea,select,video,audio,object,embed,pre,code",
        )),
      };
    });
  });

  const diagnostics = [];
  const sorted = candidates
    .filter((candidate) => candidate.visible && candidate.preferredTag)
    .sort((left, right) => (
      left.tagPriority - right.tagPriority
      || Number(left.childElementCount > 0) - Number(right.childElementCount > 0)
      || Number(left.motion) - Number(right.motion)
      || left.text.length - right.text.length
      || left.index - right.index
    ));
  for (const candidate of sorted) {
    const literal = uniqueLiteralForCandidate(source, candidate.text);
    const reasons = [
      candidate.childElementCount > 0 ? "nested-elements" : null,
      candidate.forbiddenDescendant ? "structural-descendant" : null,
      candidate.pseudoContent ? "generated-content" : null,
      candidate.motion ? "animated-ancestor" : null,
      !candidate.horizontal ? "non-horizontal-writing" : null,
      !literal ? "no-unique-source-literal" : null,
    ].filter(Boolean);
    diagnostics.push({
      sourceId: candidate.sourceId,
      tagName: candidate.tagName,
      text: candidate.text.trim().slice(0, 80),
      reasons,
    });
    if (reasons.length === 0 && literal && literal.textOffset >= 0) {
      return { ...candidate, ...literal, diagnostics };
    }
  }
  throw new Error(
    `No fail-closed native-edit candidate was found. Candidates: ${JSON.stringify(diagnostics.slice(0, 12))}`,
  );
}

async function discoverCommentCandidate(frame) {
  const candidates = await frame.locator("[data-html-ai-source-node-id]").evaluateAll((elements) => {
    const directEditRoots = new Set([
      "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "dt", "dd",
      "caption", "figcaption", "td", "th", "div",
    ]);
    const dedicatedEditorRoots = new Set([
      "input", "textarea", "select", "option", "script", "style", "template", "title",
      "canvas", "iframe", "svg", "math", "pre",
    ]);
    const dedicatedEditorSelector = [...dedicatedEditorRoots].join(",");
    const documentContainers = new Set(["html", "head", "body"]);
    return elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const pseudoContent = ["::before", "::after"].some((name) => {
        const content = getComputedStyle(element, name).content;
        return Boolean(
          content
          && content !== "none"
          && content !== "normal"
          && content !== '""'
          && content !== "''",
        );
      });
      const tagName = element.localName;
      const insideDedicatedEditorRoot = Boolean(
        element.parentElement?.closest(dedicatedEditorSelector),
      );
      const structureAtom = directEditRoots.has(tagName)
        && Boolean(element.querySelector("img,svg,math,canvas,iframe,input,textarea,select,object,embed"));
      return {
        index,
        sourceId: element.getAttribute("data-html-ai-source-node-id"),
        tagName,
        text: (element.textContent || "").trim().slice(0, 80),
        rendered: rect.width > 2 && rect.height > 2
          && style.display !== "none" && style.visibility !== "hidden",
        href: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
        childElementCount: element.childElementCount,
        documentContainer: documentContainers.has(tagName),
        dedicatedEditorRoot: dedicatedEditorRoots.has(tagName),
        insideDedicatedEditorRoot,
        structureAtom,
        pseudoContent,
      };
    });
  });
  const candidate = candidates
    .filter(({ rendered, text, documentContainer, insideDedicatedEditorRoot, dedicatedEditorRoot, structureAtom }) => (
      rendered && !documentContainer
      && !insideDedicatedEditorRoot
      && text.length > 0
      && (dedicatedEditorRoot || structureAtom)
    ))
    .sort((left, right) => (
      Number(!left.structureAtom) - Number(!right.structureAtom)
      || Number(!left.dedicatedEditorRoot) - Number(!right.dedicatedEditorRoot)
      || left.childElementCount - right.childElementCount
      || left.text.length - right.text.length
      || left.index - right.index
    ))[0];
  if (!candidate) {
    throw new Error(
      `No explicit select-comment/comment-only candidate was found. `
      + `Expected a rendered dedicated editor root or structural atom. `
      + `Sample: ${JSON.stringify(candidates.slice(0, 12))}`,
    );
  }
  const expectedCapabilities = candidate.dedicatedEditorRoot
    ? ["DEDICATED_EDITOR_REQUIRED"]
    : ["SOURCE_STRUCTURE_RANGE_UNSUPPORTED", "DEDICATED_EDITOR_REQUIRED"];
  return { ...candidate, expectedCapabilities };
}

async function visualGeometrySnapshot(handle) {
  return handle.evaluate((target) => {
    const roundedRect = (rect) => ({
      x: Math.round(rect.x * 10) / 10,
      y: Math.round(rect.y * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    });
    const visibleSourceRects = Array.from(document.querySelectorAll("[data-html-ai-source-node-id]"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.bottom >= 0 && rect.top <= innerHeight
          && rect.right >= 0 && rect.left <= innerWidth
          && rect.width > 0 && rect.height > 0
          && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => ({
        sourceId: element.getAttribute("data-html-ai-source-node-id"),
        rect: roundedRect(element.getBoundingClientRect()),
      }));
    const targetRect = target.getBoundingClientRect();
    const textRects = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) textRects.push(roundedRect(rect));
    }
    return {
      target: roundedRect(targetRect),
      textRects,
      visibleSourceRects,
      scroll: { x: scrollX, y: scrollY },
      documentSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
    };
  });
}

function expectGeometryStable(before, after) {
  expect(after.scroll).toEqual(before.scroll);
  expect(after.documentSize).toEqual(before.documentSize);
  expect(after.visibleSourceRects.map(({ sourceId }) => sourceId))
    .toEqual(before.visibleSourceRects.map(({ sourceId }) => sourceId));
  const compareRect = (left, right, label) => {
    for (const key of ["x", "y", "width", "height"]) {
      expect(right[key], `${label}.${key}`).toBeCloseTo(left[key], 0);
    }
  };
  compareRect(before.target, after.target, "target");
  expect(after.textRects).toHaveLength(before.textRects.length);
  before.textRects.forEach((rect, index) => compareRect(rect, after.textRects[index], `textRect[${index}]`));
  before.visibleSourceRects.forEach((entry, index) => (
    compareRect(entry.rect, after.visibleSourceRects[index].rect, `visible[${entry.sourceId}]`)
  ));
}

async function setHandleTextSelection(handle, start, end = start) {
  return handle.evaluate((target, offsets) => {
    const textNodes = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node);
    const pointAt = (absoluteOffset) => {
      let consumed = 0;
      for (const node of textNodes) {
        if (absoluteOffset <= consumed + node.data.length) {
          return [node, absoluteOffset - consumed];
        }
        consumed += node.data.length;
      }
      throw new RangeError(`Text offset ${absoluteOffset} is outside the candidate.`);
    };
    const [startNode, startOffset] = pointAt(offsets.start);
    const [endNode, endOffset] = pointAt(offsets.end);
    target.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { start, end });
}

async function firstRenderedTextPosition(handle) {
  return handle.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const match = /\S/u.exec(node.data);
      if (!match) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const glyphRect = range.getClientRects()[0];
      const elementRect = element.getBoundingClientRect();
      if (!glyphRect?.width || !glyphRect.height) continue;
      return {
        x: glyphRect.left - elementRect.left + Math.min(glyphRect.width / 2, 3),
        y: glyphRect.top - elementRect.top + glyphRect.height / 2,
      };
    }
    throw new Error("No rendered text glyph was found for the real-HTML candidate.");
  });
}

test("a real complex HTML file keeps layout and source authority through edit, undo and fallback", async ({ page }, testInfo) => {
  const sourcePath = validatedRealHtmlPath();
  const beforeStat = statSync(sourcePath);
  const original = readFileSync(sourcePath);
  const originalSha = sha256(original);
  const { editor, iframe, frame } = await loadRealHtml(page, sourcePath, original);
  const beforeDocument = await documentToken(frame);

  const candidate = await discoverEditableCandidate(frame, original);
  const sourceNodes = frame.locator("[data-html-ai-source-node-id]");
  const target = await sourceNodes.nth(candidate.index).elementHandle();
  if (!target) throw new Error(`Editable candidate detached before activation: ${JSON.stringify(candidate)}`);
  await target.scrollIntoViewIfNeeded();
  const beforeGeometry = await visualGeometrySnapshot(target);
  await testInfo.attach("real-html-before-edit.png", {
    body: await iframe.screenshot(),
    contentType: "image/png",
  });

  await target.dblclick({ position: await firstRenderedTextPosition(target) });
  await expect.poll(
    () => target.getAttribute("contenteditable"),
    {
      message: `Candidate did not enter native edit. candidate=${JSON.stringify(candidate)} block=${await editor.getAttribute("data-edit-block-detail")} capability=${await editor.getAttribute("data-native-capability-detail")}`,
    },
  ).toBe("plaintext-only");
  const activeState = await target.evaluate((element) => {
    const selection = document.getSelection();
    const selectionNode = selection?.anchorNode?.nodeType === Node.TEXT_NODE
      ? selection.anchorNode.parentNode
      : selection?.anchorNode;
    return {
      active: document.activeElement === element,
      editable: element.isContentEditable,
      selectionInside: Boolean(selectionNode && element.contains(selectionNode)),
    };
  });
  expect(activeState).toEqual({ active: true, editable: true, selectionInside: true });
  expect(await documentToken(frame)).toBe(beforeDocument);
  expectGeometryStable(beforeGeometry, await visualGeometrySnapshot(target));

  await setHandleTextSelection(target, candidate.textOffset);
  const caret = await target.evaluate((element) => {
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    return {
      collapsed: selection?.isCollapsed,
      active: document.activeElement === element,
      inside: Boolean(selection?.anchorNode && element.contains(
        selection.anchorNode.nodeType === Node.TEXT_NODE
          ? selection.anchorNode.parentNode
          : selection.anchorNode,
      )),
      rectHeight: range?.getBoundingClientRect().height || 0,
    };
  });
  expect(caret).toMatchObject({ collapsed: true, active: true, inside: true });
  expect(caret.rectHeight).toBeGreaterThan(0);

  const replacement = "PageRoot真实原位门禁";
  if (original.includes(Buffer.from(replacement))) {
    throw new Error(`Replacement oracle already exists in source: ${replacement}`);
  }
  const expected = replaceUniqueBytes(original, candidate.token, replacement);
  await setHandleTextSelection(
    target,
    candidate.textOffset,
    candidate.textOffset + candidate.token.length,
  );
  await page.keyboard.insertText(replacement);
  await expect.poll(() => target.textContent()).toContain(replacement);
  let previousDocumentToken = await documentToken(page);
  await page.keyboard.press(keyShortcut("S"));
  await waitForFreshFenceFrame(page, editor, previousDocumentToken);
  await expect.poll(
    () => editor.getAttribute("data-undo-depth"),
    { message: `The native DOM edit never reached SourcePatch. block=${await editor.getAttribute("data-edit-block-detail")}` },
  ).toBe("1");
  previousDocumentToken = await documentToken(page);
  const modified = await exportCurrentHtml(page);
  await waitForFreshFenceFrame(page, editor, previousDocumentToken);
  expect(
    modified.equals(expected),
    `Only the selected literal may change: ${firstByteDifference(modified, expected)}`,
  ).toBe(true);

  previousDocumentToken = await documentToken(page);
  await page.keyboard.press(keyShortcut("Z"));
  await waitForFreshFenceFrame(page, editor, previousDocumentToken);
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
  previousDocumentToken = await documentToken(page);
  await page.keyboard.press(keyShortcut("S"));
  await waitForFreshFenceFrame(page, editor, previousDocumentToken);
  previousDocumentToken = await documentToken(page);
  const restored = await exportCurrentHtml(page);
  let currentFrame = await waitForFreshFenceFrame(
    page,
    editor,
    previousDocumentToken,
  );
  expect(sha256(restored)).toBe(originalSha);
  expect(restored.equals(original), firstByteDifference(restored, original)).toBe(true);

  const remainingEditHost = currentFrame.locator('[contenteditable="plaintext-only"]');
  if (await remainingEditHost.count()) {
    await remainingEditHost.press("Escape");
    await expect(remainingEditHost).toHaveCount(0);
  }
  currentFrame = await currentEditorFrame(page);
  const commentCandidate = await discoverCommentCandidate(currentFrame);
  const commentTarget = currentFrame
    .locator(
      `[data-html-ai-source-node-id="${escapeAttributeValue(commentCandidate.sourceId)}"]`,
    );
  await expect(commentTarget, `Comment candidate must stay uniquely source-backed: ${JSON.stringify(commentCandidate)}`)
    .toHaveCount(1);
  if (commentCandidate.structureAtom) {
    const commentHandle = await commentTarget.elementHandle();
    if (!commentHandle) throw new Error("The structural fallback candidate detached before activation.");
    await commentHandle.dblclick({ position: await firstRenderedTextPosition(commentHandle) });
  } else {
    await commentTarget.dispatchEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      detail: 2,
    });
  }
  expect(await currentFrame.locator('[contenteditable="plaintext-only"]').count()).toBe(0);
  await expect.poll(async () => {
    const detail = await editor.getAttribute("data-native-capability-detail") || "";
    return commentCandidate.expectedCapabilities.some((code) => detail.includes(code));
  }, {
    message: `Expected one of ${commentCandidate.expectedCapabilities.join(", ")}: ${JSON.stringify(commentCandidate)}`,
  }).toBe(true);
  const fallbackSelection = await commentTarget.evaluate((candidateElement) => {
    const selectedElement = candidateElement.matches("[data-html-canvas-selected]")
      ? candidateElement
      : candidateElement.querySelector("[data-html-canvas-selected]")
        || candidateElement.closest("[data-html-canvas-selected]");
    const selection = document.getSelection();
    const anchorElement = selection?.anchorNode?.nodeType === Node.TEXT_NODE
      ? selection.anchorNode.parentElement
      : selection?.anchorNode;
    const focusElement = selection?.focusNode?.nodeType === Node.TEXT_NODE
      ? selection.focusNode.parentElement
      : selection?.focusNode;
    return {
      level: selectedElement?.getAttribute("data-html-canvas-selected") || null,
      selectedRelatedToCandidate: Boolean(
        selectedElement
        && (candidateElement.contains(selectedElement) || selectedElement.contains(candidateElement)),
      ),
      nativeSelectionWithinCandidate: Boolean(
        anchorElement
        && focusElement
        && candidateElement.contains(anchorElement)
        && candidateElement.contains(focusElement),
      ),
      selectedText: selection?.toString() || "",
    };
  });
  expect(
    fallbackSelection.level,
    `Fallback must select a comment target: ${JSON.stringify({ commentCandidate, fallbackSelection })}`,
  ).toMatch(/^(part|module)$/);
  expect(fallbackSelection.selectedRelatedToCandidate).toBe(true);
  expect(
    fallbackSelection.nativeSelectionWithinCandidate,
    `Fallback must retain native selection: ${JSON.stringify({ commentCandidate, fallbackSelection })}`,
  ).toBe(true);
  expect(fallbackSelection.selectedText.trim().length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /留评论|评论/ }).filter({ visible: true }).first())
    .toBeVisible();
  const notice = page.locator('[role="status"], [role="alert"]').filter({ hasText: /评论/ }).first();
  await expect(notice).toBeVisible();
  await expect(notice).not.toContainText(/SourcePatch|source anchor|TargetRef|源码映射|原 HTML 没有变化/i);
  await page.keyboard.insertText("FALLBACK_MUST_NOT_EDIT");
  const afterFallback = await exportCurrentHtml(page);
  expect(afterFallback.equals(original), firstByteDifference(afterFallback, original)).toBe(true);

  const afterStat = statSync(sourcePath);
  const diskAfter = readFileSync(sourcePath);
  expect(sha256(diskAfter), "the original desktop file SHA").toBe(originalSha);
  expect(afterStat.size).toBe(beforeStat.size);
  expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
});
