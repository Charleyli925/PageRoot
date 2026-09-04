#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";

import { chromium } from "playwright";

function argumentsMap(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Expected --name value arguments, received: ${argv.join(" ")}`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function validatedAbsoluteFile(value, extension, label) {
  if (!value || !path.isAbsolute(value) || path.extname(value).toLowerCase() !== extension) {
    throw new Error(`${label} must be an absolute ${extension} path: ${value}`);
  }
  if (!existsSync(value)) throw new Error(`${label} does not exist: ${value}`);
  return path.resolve(value);
}

function removeTemporaryRoot(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-native-e2e-census-")
  ) {
    throw new Error(`Refusing to remove non-census directory: ${directory}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}

function availableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not reserve a loopback debugging port."));
        else resolve(port);
      });
    });
  });
}

async function waitForCdpEndpoint(port, processLog) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await fetch(`${endpoint}/json/version`)
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Installed PageRoot did not expose CDP within 30 seconds.\n${processLog.join("")}`);
}

async function currentEditorFrame(page) {
  const iframe = page
    .getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first()
    .locator('iframe[title*="HTML"]');
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("Installed PageRoot did not expose its editing iframe.");
  return { frame, iframe };
}

async function sourceTextInventory(frame) {
  return frame.evaluate(() => {
    const sourceAttribute = "data-pageroot-id";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const inventory = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) continue;
      const parent = node.parentElement;
      const sourceId = parent?.getAttribute(sourceAttribute);
      if (!parent || !sourceId) continue;
      inventory.push({
        ordinal: inventory.length,
        sourceId,
        tagName: parent.localName,
        text: node.data,
        trimmedText: node.data.trim().slice(0, 100),
        characters: node.data.trim().length,
        childIndex: Array.from(parent.childNodes).indexOf(node),
      });
    }
    return inventory;
  });
}

async function suppressAuthoredClickActions(frame) {
  await frame.evaluate(() => {
    if (window.__pageRootCensusClickGuard) return;
    window.__pageRootCensusClickGuard = true;
    document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
    document.body.style.setProperty("scroll-behavior", "auto", "important");
    const stopAuthoredAction = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", stopAuthoredAction, true);
    document.addEventListener("submit", stopAuthoredAction, true);
  });
}

function isTransientFrameNavigation(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Frame was detached|Cannot find context|navigation/u.test(message);
}

async function withCurrentStableEditorFrame(page, operation) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const current = await currentEditorFrame(page);
      await current.frame.waitForLoadState("domcontentloaded");
      await suppressAuthoredClickActions(current.frame);
      const value = await operation(current);
      return { ...current, value };
    } catch (error) {
      if (!isTransientFrameNavigation(error)) throw error;
      lastError = error;
      await page.waitForTimeout(50);
    }
  }
  throw lastError || new Error("Could not obtain a stable PageRoot editor frame.");
}

async function textHitForOrdinal(frame, ordinal) {
  return frame.evaluate(async (wantedOrdinal) => {
    const sourceAttribute = "data-pageroot-id";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let currentOrdinal = 0;
    let wanted = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim() || !node.parentElement?.hasAttribute(sourceAttribute)) continue;
      if (currentOrdinal === wantedOrdinal) {
        wanted = node;
        break;
      }
      currentOrdinal += 1;
    }
    if (!wanted?.parentElement) return { hittable: false, reason: "node-missing" };
    wanted.parentElement.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    const match = /\S/u.exec(wanted.data);
    if (!match) return { hittable: false, reason: "no-non-whitespace" };
    const range = document.createRange();
    range.setStart(wanted, match.index);
    range.setEnd(wanted, match.index + match[0].length);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return { hittable: false, reason: "no-glyph-rect" };
    const rect = rects[0];
    const x = rect.left + Math.min(rect.width / 2, 3);
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const parent = wanted.parentElement;
    const style = getComputedStyle(parent);
    const viewportHit = x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight;
    const directlyHit = Boolean(hit && (hit === parent || parent.contains(hit)));
    const rendered = style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || "1") > 0;
    return {
      hittable: viewportHit && directlyHit && rendered,
      reason: !viewportHit
        ? "outside-viewport"
        : !directlyHit
          ? "covered-or-inert"
          : !rendered
            ? "hidden"
            : null,
      x,
      y,
      hitTagName: hit?.localName ?? null,
    };
  }, ordinal);
}

async function resultForOrdinal(frame, ordinal) {
  return frame.evaluate((wantedOrdinal) => {
    const sourceAttribute = "data-pageroot-id";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let currentOrdinal = 0;
    let wanted = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim() || !node.parentElement?.hasAttribute(sourceAttribute)) continue;
      if (currentOrdinal === wantedOrdinal) {
        wanted = node;
        break;
      }
      currentOrdinal += 1;
    }
    const hosts = Array.from(document.querySelectorAll('[contenteditable="plaintext-only"]'));
    const host = hosts[0] ?? null;
    const selection = document.getSelection();
    const selectionNode = selection?.anchorNode?.nodeType === Node.TEXT_NODE
      ? selection.anchorNode.parentElement
      : selection?.anchorNode;
    return {
      hostCount: hosts.length,
      hostSourceId: host?.getAttribute(sourceAttribute) ?? null,
      hostTagName: host?.localName ?? null,
      correctTarget: Boolean(wanted && hosts.length === 1 && host?.contains(wanted)),
      selectionInsideHost: Boolean(host && selectionNode && host.contains(selectionNode)),
      selectedText: selection?.toString() ?? "",
    };
  }, ordinal);
}

function capabilityCode(detail, status) {
  const fromDetail = typeof detail === "string" ? /^([^:]+)/u.exec(detail)?.[1] : null;
  if (fromDetail) return fromDetail;
  if (typeof status === "string" && status.startsWith("capability:")) return status.slice(11);
  return status || "NO_START_RESULT";
}

async function mediaSafetyChecks(page, frame, outerIframe) {
  const checks = [];
  for (const selector of ["canvas", "iframe"]) {
    const count = await frame.locator(selector).count();
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      const target = frame.locator(selector).nth(index);
      await target.scrollIntoViewIfNeeded().catch(() => {});
      const outerBox = await outerIframe.boundingBox();
      const rect = await target.evaluate((element) => {
        const value = element.getBoundingClientRect();
        return { x: value.x, y: value.y, width: value.width, height: value.height };
      });
      if (!outerBox || rect.width <= 0 || rect.height <= 0) continue;
      await page.mouse.dblclick(
        outerBox.x + rect.x + rect.width / 2,
        outerBox.y + rect.y + rect.height / 2,
      );
      await page.waitForTimeout(20);
      const state = await frame.evaluate(() => ({
        editableCount: document.querySelectorAll('[contenteditable="plaintext-only"]').length,
        selectedText: document.getSelection()?.toString() ?? "",
      }));
      checks.push({ selector, index, ...state });
    }
  }

  const nestedFrames = page.frames().filter((candidate) => candidate.parentFrame() === frame);
  for (const [iframeIndex, nestedFrame] of nestedFrames.entries()) {
    const frameElement = await nestedFrame.frameElement();
    const frameBox = await frameElement.boundingBox();
    if (!frameBox) continue;
    const border = await frameElement.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        left: Number.parseFloat(style.borderLeftWidth) || 0,
        top: Number.parseFloat(style.borderTopWidth) || 0,
      };
    });
    const nestedTextChecks = await nestedFrame.evaluate(() => {
      const values = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const match = /\S/u.exec(node.data);
        if (!match) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getClientRects()[0];
        if (!rect?.width || !rect.height) continue;
        values.push({
          text: node.data.trim().slice(0, 100),
          x: rect.x + Math.min(rect.width / 2, 3),
          y: rect.y + rect.height / 2,
        });
      }
      return values;
    });
    for (const nested of nestedTextChecks) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.mouse.dblclick(
        frameBox.x + border.left + nested.x,
        frameBox.y + border.top + nested.y,
      );
      await page.waitForTimeout(20);
      const state = await frame.evaluate(() => ({
        editableCount: document.querySelectorAll('[contenteditable="plaintext-only"]').length,
        editableText: Array.from(document.querySelectorAll('[contenteditable="plaintext-only"]'))
          .map((element) => element.textContent?.trim().slice(0, 100) ?? ""),
        selectedText: document.getSelection()?.toString() ?? "",
      }));
      checks.push({ selector: "iframe-inner-text", iframeIndex, ...nested, ...state });
    }
  }
  return checks;
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  const appPath = validatedAbsoluteFile(args.get("app"), ".app", "--app");
  const htmlPath = validatedAbsoluteFile(args.get("html"), ".html", "--html");
  const outputPath = path.resolve(args.get("output") || "output/text-editability-census.json");
  const screenshotPath = path.resolve(
    args.get("screenshot") || path.join(path.dirname(outputPath), "installed-census.png"),
  );
  const executable = path.join(appPath, "Contents/MacOS/PageRoot");
  if (!existsSync(executable)) throw new Error(`PageRoot executable is missing: ${executable}`);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  mkdirSync(path.dirname(screenshotPath), { recursive: true });

  const originalSha = sha256(htmlPath);
  const originalSize = statSync(htmlPath).size;
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-census-"));
  const isolatedUserData = path.join(temporaryRoot, "user-data");
  const workspace = path.join(temporaryRoot, "workspace");
  const sourceDirectory = path.join(temporaryRoot, "source");
  mkdirSync(isolatedUserData, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(sourceDirectory, { recursive: true });
  const copyPath = path.join(sourceDirectory, path.basename(htmlPath));
  copyFileSync(htmlPath, copyPath);

  let browser = null;
  try {
    const debuggingPort = await availableLoopbackPort();
    const launch = spawnSync(
      "/usr/bin/open",
      ["-na", appPath, "--args", `--remote-debugging-port=${debuggingPort}`],
      { encoding: "utf8" },
    );
    if (launch.status !== 0) {
      throw new Error(`Could not launch installed PageRoot through macOS: ${launch.stderr || launch.stdout}`);
    }
    const processLog = [launch.stderr || "", launch.stdout || ""];
    const endpoint = await waitForCdpEndpoint(debuggingPort, processLog);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context?.pages()[0] || await context?.waitForEvent("page", { timeout: 15_000 });
    if (!page) throw new Error("Installed PageRoot opened no renderer page.");
    await page.waitForLoadState("domcontentloaded");
    const runtime = await page.evaluate(() => window.htmlAIRuntime);
    const activeProject = await page.evaluate(() => window.htmlAIProjects?.getActiveProject());
    if (activeProject?.sourcePath !== htmlPath) {
      throw new Error(
        `Installed PageRoot restored a different disk project: ${activeProject?.sourcePath || "none"}`,
      );
    }
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    await editor.waitFor({ state: "visible" });
    await page.waitForFunction(
      (element) => element?.getAttribute("data-render-verified") === "true",
      await editor.elementHandle(),
    );
    let { frame, iframe } = await currentEditorFrame(page);
    await frame.waitForFunction(() => document.readyState === "complete" && Boolean(document.body));
    await suppressAuthoredClickActions(frame);
    const inventory = await sourceTextInventory(frame);
    const results = [];

    for (const item of inventory) {
      if (item.ordinal % 25 === 0) {
        process.stderr.write(`census ${item.ordinal}/${inventory.length}\n`);
      }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await editor.evaluate((element) => {
        element.removeAttribute("data-native-start-status");
        element.removeAttribute("data-native-capability-detail");
      });
      const hitContext = await withCurrentStableEditorFrame(
        page,
        ({ frame: currentFrame }) => textHitForOrdinal(currentFrame, item.ordinal),
      );
      ({ frame, iframe } = hitContext);
      const hit = hitContext.value;
      if (!hit.hittable) {
        results.push({ ...item, ...hit, outcome: "UNHITTABLE" });
        continue;
      }
      const outerBox = await iframe.boundingBox();
      if (!outerBox) {
        results.push({ ...item, ...hit, hittable: false, outcome: "UNHITTABLE", reason: "editor-frame-hidden" });
        continue;
      }
      await page.mouse.dblclick(outerBox.x + hit.x, outerBox.y + hit.y);
      await page.waitForTimeout(20);
      const resultContext = await withCurrentStableEditorFrame(
        page,
        ({ frame: currentFrame }) => resultForOrdinal(currentFrame, item.ordinal),
      );
      ({ frame, iframe } = resultContext);
      const state = resultContext.value;
      const status = await editor.getAttribute("data-native-start-status");
      const detail = await editor.getAttribute("data-native-capability-detail");
      const outcome = state.correctTarget && state.selectionInsideHost
        ? "EDITABLE"
        : state.hostCount > 0
          ? "WRONG_TARGET"
          : capabilityCode(detail, status);
      results.push({ ...item, ...hit, ...state, status, detail, outcome });
    }

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    ({ frame, iframe } = await currentEditorFrame(page));
    await frame.waitForFunction(() => document.readyState === "complete" && Boolean(document.body));
    await suppressAuthoredClickActions(frame);
    const mediaChecks = await mediaSafetyChecks(page, frame, iframe);
    await frame.evaluate(() => scrollTo({ top: 0, left: 0, behavior: "auto" }));
    await page.waitForTimeout(100);
    await page.screenshot({ path: screenshotPath, type: "png" });

    const hittable = results.filter((item) => item.hittable);
    const editable = hittable.filter((item) => item.outcome === "EDITABLE");
    const glyphBacked = results.filter((item) => item.reason !== "no-glyph-rect");
    const byOutcome = Object.fromEntries(
      [...new Set(results.map((item) => item.outcome))]
        .sort()
        .map((outcome) => [outcome, results.filter((item) => item.outcome === outcome).length]),
    );
    const byTag = Object.fromEntries(
      [...new Set(results.map((item) => item.tagName))]
        .sort()
        .map((tagName) => {
          const tagged = results.filter((item) => item.tagName === tagName);
          return [tagName, {
            total: tagged.length,
            glyphBacked: tagged.filter((item) => item.reason !== "no-glyph-rect").length,
            hittable: tagged.filter((item) => item.hittable).length,
            editable: tagged.filter((item) => item.outcome === "EDITABLE").length,
          }];
        }),
    );
    const report = {
      testedAt: new Date().toISOString(),
      appPath,
      appVersion: runtime?.appVersion ?? null,
      htmlPath,
      activeSourcePath: activeProject.sourcePath,
      testedCopyPath: null,
      source: { size: originalSize, sha256: originalSha },
      summary: {
        totalSourceTextNodes: results.length,
        glyphBackedTextNodes: glyphBacked.length,
        noGlyphTextNodes: results.length - glyphBacked.length,
        hittableTextNodes: hittable.length,
        editableTextNodes: editable.length,
        nonEditableHittableTextNodes: hittable.length - editable.length,
        editableRateOfHittable: hittable.length > 0
          ? Math.round((editable.length / hittable.length) * 1000) / 10
          : 0,
        hittableCharacters: hittable.reduce((sum, item) => sum + item.characters, 0),
        editableCharacters: editable.reduce((sum, item) => sum + item.characters, 0),
        wrongTargetCount: results.filter((item) => item.outcome === "WRONG_TARGET").length
          + mediaChecks.filter((item) => item.editableCount > 0).length,
      },
      byOutcome,
      byTag,
      mediaChecks,
      results,
    };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ outputPath, screenshotPath, ...report.summary, byOutcome }, null, 2)}\n`);
  } finally {
    await browser?.close().catch(() => {});
    const finalOriginalSha = sha256(htmlPath);
    const finalCopySha = sha256(copyPath);
    if (finalOriginalSha !== originalSha || finalCopySha !== originalSha) {
      throw new Error(`Census changed source bytes: original=${finalOriginalSha} copy=${finalCopySha}`);
    }
    removeTemporaryRoot(temporaryRoot);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
