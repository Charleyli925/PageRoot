import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
export const productRoot = path.resolve(currentDirectory, "../../..");
export const fixtureRoot = path.join(productRoot, "tests/fixtures/native-dom");

export function fixturePath(name) {
  if (!/^[a-z0-9][a-z0-9.-]*\.html$/i.test(name)) {
    throw new TypeError(`Unsafe native DOM fixture name: ${name}`);
  }
  return path.join(fixtureRoot, name);
}

export function fixtureBuffer(name) {
  return readFileSync(fixturePath(name));
}

export function loadCaseManifest() {
  return JSON.parse(readFileSync(path.join(fixtureRoot, "cases.json"), "utf8"));
}

export function withBomAndCrLf(buffer) {
  const source = buffer.toString("utf8").replace(/\r?\n/g, "\r\n");
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source, "utf8")]);
}

function pageForFrame(frameOrPage) {
  if (frameOrPage && typeof frameOrPage.mainFrame === "function") return frameOrPage;
  if (frameOrPage && typeof frameOrPage.page === "function") return frameOrPage.page();
  throw new TypeError("Expected a Playwright Page or PageRoot edit Frame.");
}

export function currentEditorIframe(frameOrPage) {
  const page = pageForFrame(frameOrPage);
  return page
    .getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first()
    .locator('iframe[title*="HTML"]');
}

export async function currentEditorFrame(frameOrPage) {
  const page = pageForFrame(frameOrPage);
  const iframe = currentEditorIframe(page);
  await iframe.waitFor({ state: "attached" });

  // A History Fence deliberately replaces the iframe element. The locator is
  // resilient to that replacement, while an ElementHandle/Frame is not. A
  // short retry closes the tiny gap between resolving the current element and
  // Chromium exposing its new same-origin browsing context.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const iframeHandle = await iframe.elementHandle();
    const frame = await iframeHandle?.contentFrame();
    if (frame && !frame.isDetached()) return frame;
    await page.waitForTimeout(10);
  }
  throw new Error("PageRoot edit iframe did not expose a current same-origin Frame.");
}

export function currentNativeTarget(frameOrPage, id) {
  return currentEditorIframe(frameOrPage).contentFrame().locator(caseSelector(id));
}

function resilientEditorFrame(page) {
  const runInCurrentFrame = async (operation) => {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const frame = await currentEditorFrame(page);
      try {
        return await operation(frame);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const wasReplaced = frame.isDetached()
          || /detached|Execution context was destroyed|Cannot find context/i.test(message);
        if (!wasReplaced) throw error;
      }
    }
    throw lastError || new Error("PageRoot edit Frame was repeatedly replaced.");
  };

  return {
    page: () => page,
    locator: (selector, options) => (
      currentEditorIframe(page).contentFrame().locator(selector, options)
    ),
    evaluate: (pageFunction, arg) => (
      runInCurrentFrame((frame) => frame.evaluate(pageFunction, arg))
    ),
    waitForFunction: (pageFunction, arg, options) => (
      runInCurrentFrame((frame) => frame.waitForFunction(pageFunction, arg, options))
    ),
    frameElement: () => runInCurrentFrame((frame) => frame.frameElement()),
  };
}

async function ensureDesktopRendererTestBridge(page) {
  const hasDesktopBridge = await page.evaluate(() => Boolean(window.htmlAIProjects));
  if (hasDesktopBridge) return;

  await page.addInitScript(() => {
    Object.defineProperty(window, "htmlAIProjects", {
      configurable: true,
      value: {
        getActiveProject: async () => null,
        openHtml: async () => null,
        listRecentProjects: async () => [],
        openRecent: async () => {
          throw new Error("The browser renderer harness has no recent files.");
        },
      },
    });
  });
  await page.reload();
}

export async function loadFixture(page, name, { buffer = fixtureBuffer(name) } = {}) {
  // Pure browser use is a formal read-only preview. These source-editing tests
  // exercise the desktop renderer, so expose only the narrow capability marker
  // needed to mount its editor before loading an in-memory fixture.
  await ensureDesktopRendererTestBridge(page);
  // The real UI opens the file picker only after prepareProjectSwitch() has
  // confirmed that the current canvas can commit. Setting a hidden file input
  // directly bypasses that user-facing gate, so first wait for the initial
  // canvas to reach the same ready state.
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  await editor.waitFor({ state: "visible" });
  // Keep this readiness check locator-backed. React hydration may replace the
  // server-rendered editor node after it first becomes visible; an
  // ElementHandle captured before that replacement would wait forever on a
  // detached node even though the current Canvas is already verified.
  await expect(editor).toHaveAttribute("data-render-verified", "true");

  const fileInput = page.locator('input[type="file"][accept*=".html"]').first();
  await fileInput.waitFor({ state: "attached" });
  await fileInput.setInputFiles({
    name,
    mimeType: "text/html",
    buffer,
  });
  await page.getByText(name, { exact: true }).first().waitFor({ state: "visible" });

  await expect(editor).toHaveAttribute("data-render-verified", "true");

  const iframe = editor.locator('iframe[title*="HTML"]');
  await iframe.waitFor({ state: "visible" });
  const initialFrame = await currentEditorFrame(page);
  await initialFrame.waitForFunction(() => document.readyState === "complete");
  await initialFrame.waitForFunction(() => Boolean(document.querySelector("[data-native-case]")));
  return { editor, iframe, frame: resilientEditorFrame(page), source: buffer };
}

export function caseSelector(id) {
  return `[data-native-case=${JSON.stringify(id)}]`;
}

export async function documentToken(frameOrPage) {
  return currentEditorIframe(frameOrPage).evaluate((frameElement) => {
    const key = "__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__";
    const view = frameElement.contentWindow;
    if (!view) throw new Error("PageRoot edit iframe has no active window.");
    if (!view[key]) view[key] = crypto.randomUUID();
    return view[key];
  });
}

export async function geometrySnapshot(frame, id) {
  return currentNativeTarget(frame, id).evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const parentRect = target.parentElement?.getBoundingClientRect();
    const style = getComputedStyle(target);
    return {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      parentRect: parentRect ? {
        x: parentRect.x,
        y: parentRect.y,
        width: parentRect.width,
        height: parentRect.height,
      } : null,
      parentScroll: target.parentElement ? {
        left: target.parentElement.scrollLeft,
        top: target.parentElement.scrollTop,
      } : null,
      scroll: {
        left: target.scrollLeft,
        top: target.scrollTop,
        width: target.scrollWidth,
        height: target.scrollHeight,
      },
      style: {
        display: style.display,
        position: style.position,
        font: style.font,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        whiteSpace: style.whiteSpace,
        writingMode: style.writingMode,
        direction: style.direction,
        transform: style.transform,
      },
    };
  });
}

export async function doubleClickRenderedText(frame, id, position) {
  const target = currentNativeTarget(frame, id);
  const textPosition = position || await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const match = /\S/u.exec(node.data);
      if (!match) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const glyphRect = range.getClientRects()[0];
      const elementRect = element.getBoundingClientRect();
      // Chromium on Linux can report a zero-sized inline axis for a valid
      // vertical-writing glyph. The other axis still identifies a real hit
      // target, so pad only the missing axis instead of rejecting the glyph.
      if (!glyphRect || (!glyphRect.width && !glyphRect.height)) continue;
      return {
        x: glyphRect.left - elementRect.left
          + (glyphRect.width ? Math.min(glyphRect.width / 2, 3) : 1),
        y: glyphRect.top - elementRect.top
          + (glyphRect.height ? glyphRect.height / 2 : 1),
      };
    }
    throw new Error(`No rendered text glyph found for native edit case ${element.getAttribute("data-native-case")}.`);
  });
  await target.dblclick({ position: textPosition });
  return target;
}

export async function activateNativeEdit(frame, id, position) {
  const target = await doubleClickRenderedText(frame, id, position);
  try {
    await currentEditorFrame(frame).then((currentFrame) => currentFrame.waitForFunction((caseId) => {
      const expected = document.querySelector(`[data-native-case=${JSON.stringify(caseId)}]`);
      return ["plaintext-only", "true"].includes(
        expected?.getAttribute("contenteditable"),
      )
        && document.activeElement === expected
        && expected.isContentEditable;
    }, id, { timeout: 7_000 }));
  } catch (cause) {
    const page = pageForFrame(frame);
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    throw new Error(
      `Native edit ${id} did not activate. status=${await editor.getAttribute("data-native-start-status")} `
      + `capability=${await editor.getAttribute("data-native-capability-detail")} `
      + `block=${await editor.getAttribute("data-edit-block-detail")}`,
      { cause },
    );
  }
  return target;
}

export async function nativeEditingState(frame, id) {
  return currentNativeTarget(frame, id).evaluate((target) => {
    const active = document.activeElement;
    const selection = document.getSelection();
    return {
      targetIsActive: active === target,
      contenteditable: target.getAttribute("contenteditable"),
      isContentEditable: target.isContentEditable,
      activeCase: active instanceof Element ? active.getAttribute("data-native-case") : null,
      activeIsLegacySurface: Boolean(active?.closest?.("[data-html-canvas-text-flow-surface]")),
      legacySurfaceCount: document.querySelectorAll("[data-html-canvas-text-flow-surface]").length,
      authoredNodeHidden: getComputedStyle(target).visibility === "hidden"
        || getComputedStyle(target).display === "none",
      selectionInside: Boolean(
        selection?.anchorNode
        && target.contains(selection.anchorNode.nodeType === Node.TEXT_NODE
          ? selection.anchorNode.parentNode
          : selection.anchorNode),
      ),
    };
  });
}

export async function selectionSnapshot(frame, id) {
  return currentNativeTarget(frame, id).evaluate((target) => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { rangeCount: 0, text: "", collapsed: true };
    }

    const linearOffset = (node, offset) => {
      if (!node || !target.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node)) {
        return null;
      }
      const probe = document.createRange();
      probe.selectNodeContents(target);
      probe.setEnd(node, offset);
      return probe.toString().length;
    };
    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    const anchorOffset = linearOffset(selection.anchorNode, selection.anchorOffset);
    const focusOffset = linearOffset(selection.focusNode, selection.focusOffset);
    const nativeDirection = selection.direction || null;
    return {
      rangeCount: selection.rangeCount,
      text: selection.toString(),
      collapsed: selection.isCollapsed,
      anchorOffset,
      focusOffset,
      direction: nativeDirection && nativeDirection !== "none"
        ? nativeDirection
        : anchorOffset !== null && focusOffset !== null && anchorOffset > focusOffset
          ? "backward"
          : anchorOffset !== focusOffset ? "forward" : "none",
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      activeCase: document.activeElement?.getAttribute?.("data-native-case") || null,
    };
  });
}

export async function setTextSelection(frame, id, start, end = start) {
  return currentNativeTarget(frame, id).evaluate((target, offsets) => {
    const textNodes = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node);
    const totalLength = textNodes.reduce((sum, node) => sum + node.data.length, 0);
    if (offsets.start < 0 || offsets.end < offsets.start || offsets.end > totalLength) {
      throw new RangeError(`Selection ${offsets.start}:${offsets.end} exceeds ${totalLength}.`);
    }
    const pointAt = (absoluteOffset) => {
      let consumed = 0;
      for (const node of textNodes) {
        const next = consumed + node.data.length;
        if (absoluteOffset <= next) return [node, absoluteOffset - consumed];
        consumed = next;
      }
      const last = textNodes.at(-1);
      return [last, last?.data.length || 0];
    };
    const [startNode, startOffset] = pointAt(offsets.start);
    const [endNode, endOffset] = pointAt(offsets.end);
    if (!startNode || !endNode) throw new Error("Editable case has no text nodes.");
    target.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  }, { start, end });
}

export async function clickTextPosition(frame, id, position) {
  if (!["start", "middle", "end"].includes(position)) {
    throw new TypeError(`Unknown text click position: ${position}`);
  }
  const target = currentNativeTarget(frame, id);
  const point = await target.evaluate((element, requestedPosition) => {
    const textNodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.data.length > 0) textNodes.push(node);
    }
    const length = textNodes.reduce((total, node) => total + node.data.length, 0);
    if (length === 0) throw new Error("Editable case has no visible text glyphs.");
    const characterIndex = requestedPosition === "start"
      ? 0
      : requestedPosition === "end"
        ? length - 1
        : Math.floor((length - 1) / 2);
    let consumed = 0;
    let textNode = textNodes[0];
    let localOffset = 0;
    for (const candidate of textNodes) {
      if (characterIndex < consumed + candidate.data.length) {
        textNode = candidate;
        localOffset = characterIndex - consumed;
        break;
      }
      consumed += candidate.data.length;
    }
    const range = document.createRange();
    range.setStart(textNode, localOffset);
    range.setEnd(textNode, localOffset + 1);
    const glyphRect = range.getClientRects()[0] || range.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    const horizontalBias = requestedPosition === "start"
      ? 0.15
      : requestedPosition === "end" ? 0.85 : 0.5;
    return {
      x: glyphRect.left - targetRect.left + glyphRect.width * horizontalBias,
      y: glyphRect.top - targetRect.top + glyphRect.height / 2,
    };
  }, position);
  await target.click({ position: point });
  return selectionSnapshot(frame, id);
}

export async function reverseTextSelection(frame, id, start, end) {
  return currentNativeTarget(frame, id).evaluate((target, offsets) => {
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
      throw new RangeError("Reverse selection offset is outside the case text.");
    };
    const [startNode, startOffset] = pointAt(offsets.start);
    const [endNode, endOffset] = pointAt(offsets.end);
    target.focus({ preventScroll: true });
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.setBaseAndExtent(endNode, endOffset, startNode, startOffset);
    return selection.toString();
  }, { start, end });
}

export async function installInputRecorder(frame) {
  const iframe = await frame.frameElement();
  await iframe.evaluate((frameElement) => {
    frameElement.__PAGEROOT_NATIVE_QA_MUTATION_OBSERVER__?.disconnect();
    const events = [];
    let sequence = 0;
    const documentNode = frameElement.contentDocument;
    const view = frameElement.contentWindow;
    const caseForNode = (node) => {
      const element = node?.nodeType === view.Node.ELEMENT_NODE
        ? node
        : node?.parentElement;
      return element?.closest?.("[data-native-case]") || null;
    };
    const selectionState = (host) => {
      const selection = documentNode.getSelection();
      if (
        !host
        || !selection
        || selection.rangeCount !== 1
        || !selection.anchorNode
        || !selection.focusNode
        || !host.contains(selection.anchorNode)
        || !host.contains(selection.focusNode)
      ) return null;
      const logicalOffset = (node, offset) => {
        const range = documentNode.createRange();
        range.selectNodeContents(host);
        try {
          range.setEnd(node, offset);
        } catch {
          return null;
        }
        return range.toString().length;
      };
      const range = selection.getRangeAt(0);
      const collapsed = selection.isCollapsed;
      const anchor = logicalOffset(selection.anchorNode, selection.anchorOffset);
      const focus = logicalOffset(selection.focusNode, selection.focusOffset);
      const direction = collapsed
        ? "none"
        : selection.anchorNode === range.startContainer
          && selection.anchorOffset === range.startOffset
          ? "forward"
          : "backward";
      return {
        anchor,
        focus,
        direction,
        collapsed,
        text: selection.toString(),
      };
    };
    const snapshot = (host) => ({
      activeCase: caseForNode(documentNode.activeElement)?.getAttribute("data-native-case") || null,
      selection: selectionState(host),
      innerHTML: host?.innerHTML ?? null,
      textContent: host?.textContent ?? null,
    });
    const record = (event) => {
      const host = caseForNode(event.target) || caseForNode(documentNode.activeElement);
      const entry = {
        sequence: ++sequence,
        type: event.type,
        key: typeof event.key === "string" ? event.key : null,
        code: typeof event.code === "string" ? event.code : null,
        inputType: event.inputType || null,
        data: typeof event.data === "string" ? event.data : null,
        isComposing: Boolean(event.isComposing),
        isTrusted: event.isTrusted,
        cancelable: event.cancelable,
        defaultPrevented: event.defaultPrevented,
        targetCase: host?.getAttribute("data-native-case") || null,
        targetRangeCount: typeof event.getTargetRanges === "function"
          ? event.getTargetRanges().length
          : null,
        ...snapshot(host),
      };
      events.push(entry);
      // The recorder is attached at document capture so it can see the exact
      // platform event before PageRoot handles it. Refresh this one field in a
      // microtask so diagnostics also preserve the final preventDefault state.
      view.queueMicrotask(() => {
        entry.defaultPrevented = event.defaultPrevented;
      });
    };
    for (const type of [
      "keydown",
      "keyup",
      "beforeinput",
      "input",
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "paste",
      "cut",
      "focusin",
      "focusout",
      "selectionchange",
    ]) frameElement.contentDocument.addEventListener(type, record, true);
    const mutationObserver = new view.MutationObserver((records) => {
      const relevant = records.filter((mutation) => (
        Boolean(caseForNode(mutation.target))
        || Array.from(mutation.addedNodes).some((node) => Boolean(caseForNode(node)))
        || Array.from(mutation.removedNodes).some((node) => Boolean(caseForNode(node)))
      ));
      if (relevant.length === 0) return;
      const host = caseForNode(relevant[0].target)
        || relevant.flatMap((mutation) => Array.from(mutation.addedNodes))
          .map(caseForNode)
          .find(Boolean)
        || caseForNode(documentNode.activeElement);
      events.push({
        sequence: ++sequence,
        type: "mutation",
        targetCase: host?.getAttribute("data-native-case") || null,
        mutations: relevant.map((mutation) => ({
          type: mutation.type,
          attributeName: mutation.attributeName,
          oldValue: mutation.oldValue,
          added: Array.from(mutation.addedNodes).map((node) => (
            node.nodeType === view.Node.TEXT_NODE
              ? `#text:${node.data}`
              : node.nodeName.toLowerCase()
          )),
          removed: Array.from(mutation.removedNodes).map((node) => (
            node.nodeType === view.Node.TEXT_NODE
              ? `#text:${node.data}`
              : node.nodeName.toLowerCase()
          )),
        })),
        ...snapshot(host),
      });
    });
    mutationObserver.observe(documentNode.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeOldValue: true,
    });
    frameElement.__PAGEROOT_NATIVE_QA_INPUT_EVENTS__ = events;
    frameElement.__PAGEROOT_NATIVE_QA_MUTATION_OBSERVER__ = mutationObserver;
  });
}

export async function recordedInputEvents(frame) {
  const iframe = await frame.frameElement();
  return iframe.evaluate(
    (frameElement) => frameElement.__PAGEROOT_NATIVE_QA_INPUT_EVENTS__ || [],
  );
}

export async function installLongTaskRecorder(frame) {
  const iframe = await frame.frameElement();
  await iframe.evaluate((frameElement) => {
    const durations = [];
    const FramePerformanceObserver = frameElement.contentWindow.PerformanceObserver;
    const observer = new FramePerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
    frameElement.__PAGEROOT_NATIVE_QA_LONG_TASKS__ = durations;
    frameElement.__PAGEROOT_NATIVE_QA_LONG_TASK_OBSERVER__ = observer;
  });
}

export async function recordedLongTasks(frame) {
  const iframe = await frame.frameElement();
  return iframe.evaluate(
    (frameElement) => frameElement.__PAGEROOT_NATIVE_QA_LONG_TASKS__ || [],
  );
}

export async function waitForFramePaint(frame) {
  const iframe = await frame.frameElement();
  await iframe.evaluate((frameElement) => new Promise((resolve) => {
    const view = frameElement.ownerDocument.defaultView;
    view.requestAnimationFrame(() => view.requestAnimationFrame(resolve));
  }));
}

export async function dragSelection(page, frame, id, { from = 0.12, to = 0.88 } = {}) {
  const box = await currentNativeTarget(frame, id).boundingBox();
  if (!box) throw new Error(`Cannot drag-select invisible case ${id}.`);
  const y = box.y + Math.min(box.height / 2, 22);
  const startX = box.x + box.width * from;
  const endX = box.x + box.width * to;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: startX,
      y,
      button: "none",
      buttons: 0,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: startX,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    // Chromium can keep drag-selection moves pending until it receives the
    // release. Queue the gesture before awaiting the protocol responses.
    const moves = [];
    for (let step = 1; step <= 4; step += 1) {
      moves.push(cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: startX + ((endX - startX) * step) / 4,
        y,
        button: "left",
        buttons: 1,
      }));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const release = cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: endX,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await Promise.all([...moves, release]);
  } finally {
    await cdp.detach();
  }
  return selectionSnapshot(frame, id);
}

export function keyShortcut(key) {
  return `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;
}

export async function requestExportCurrentHtml(page) {
  await page.keyboard.press(keyShortcut("Shift+E"));
}

export async function exportCurrentHtml(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    requestExportCurrentHtml(page),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Export download did not expose a readable stream.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function replaceUniqueBytes(source, beforeText, afterText) {
  const before = Buffer.from(beforeText, "utf8");
  const after = Buffer.from(afterText, "utf8");
  const start = source.indexOf(before);
  if (start < 0 || source.indexOf(before, start + before.length) >= 0) {
    throw new Error(`Byte oracle token must occur exactly once: ${beforeText}`);
  }
  return Buffer.concat([
    source.subarray(0, start),
    after,
    source.subarray(start + before.length),
  ]);
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function readDownloadPath(downloadPath) {
  const chunks = [];
  for await (const chunk of createReadStream(downloadPath)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
