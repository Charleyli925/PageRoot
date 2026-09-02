import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { caseSelector, productRoot } from "../browser/pageroot-driver.mjs";
import { chooseClipboardDelivery } from "./ai-closed-loop-helpers.mjs";
import {
  closePageRootGracefully,
  createSourceFixture,
  launchPageRoot,
  loadedDiskFrame,
  removeSourceFixture,
  removeValidatedTemporaryDirectory,
} from "./helpers/pageroot-app-fixture.mjs";

/**
 * Review annotation clarity against a realistic Chinese report page.
 *
 * The reported defects were all visible on a dense business report: outlines
 * nested three deep around one change, a red strike that read as a solid line,
 * green dots scattered under punctuation at uneven baselines, and text still on
 * the page announced as deleted or inserted. This spec drives the real app to
 * the review page with that shape of content and measures the rendered
 * projection, because none of these are provable from unit geometry alone.
 */

const USER_DATA_PREFIX = "pageroot-native-e2e-review-annotation-";
const SOURCE_PREFIX = "pageroot-review-annotation-source-";

const TREND_BEFORE = "内容平台搜索挤压传统搜索引擎与传统电商的趋势不变，但大盘增量呈现增速放缓态势——26Q2 国内主流平台日均搜索请求次数 96.2 亿次，YoY +18%；较 26 年 1&amp;2 月双月大盘增速 +20% 回落 2pp；增速放缓的同时结构变化加剧：抖系份额收缩、微信与小红书接棒增长；大盘增长动能加速向内容平台迁移。";
const TREND_AFTER = "大盘增量增速放缓（96.2 亿次/日，YoY +18%，较 1&amp;2 月 +20% 回落 2pp），但结构变化加剧：抖系份额收缩，微信、小红书接棒增长。";
const NOTE_BEFORE = "增速较 1–2 月 +20% 走弱；抖系份额 -0.7pp，微信 +5.4pp、红书 +1.3pp 是唯三正增长入口";
const NOTE_AFTER = "增速较 1–2 月 +20% 走弱；微信 +5.4pp、红书 +1.3pp 正增长，抖系 -0.7pp";
const ORDINARY_MODULE_AFTER = "    <section class=\"ordinary-module\" data-review-ordinary-replacement>全新普通模块：海外广告买量策略</section>";
/** The AI candidate: text edits, one added wrapper, and ignored style edits. */
function rewriteReport(source) {
  const firstTab = source.match(
    /<span\b(?=[^>]*class="tab")(?=[^>]*data-active="true")[^>]*>① 大盘 &amp; 电商搜索<\/span>/u,
  )?.[0];
  const secondTab = source.match(
    /<span\b(?=[^>]*class="tab")[^>]*>② 抖音搜盘表现<\/span>/u,
  )?.[0];
  const tabPairBefore = firstTab && secondTab
    ? `${firstTab}\n      ${secondTab}`
    : "\u0000";
  const tabPairAfter = firstTab && secondTab
    ? `${secondTab}\n      ${firstTab}`
    : "";
  const jdCard = source.match(
    /<div\b(?=[^>]*class="metric")(?=[^>]*data-report-metric="jd-retail-profit")[^>]*>[\s\S]*?<p\b(?=[^>]*data-review-jd-note)[^>]*>零售基本盘保持韧性；利润率仍需观察。<\/p>\s*<\/div>/u,
  )?.[0];
  const jdNote = jdCard?.match(
    /<p\b(?=[^>]*data-review-jd-note)[^>]*>零售基本盘保持韧性；利润率仍需观察。<\/p>/u,
  )?.[0];
  const changedJdCard = jdCard && jdNote
    ? jdCard.replace(
      jdNote,
      jdNote.replace(/^<p\b/u, "<ul").replace(
        />零售基本盘保持韧性；利润率仍需观察。<\/p>$/u,
        "><li>零售基本盘保持韧性；</li><li>利润率仍需观察。</li></ul>",
      ),
    )
    : "";
  const ordinaryModule = source.match(
    /<div\b(?=[^>]*class="ordinary-module")(?=[^>]*data-review-ordinary-replacement)[^>]*><h2[^>]*>普通标题<\/h2><p[^>]*>北方仓储周转红线<\/p><\/div>/u,
  )?.[0];
  return source
    .replace("边缘旧值", "边缘新值")
    .replace("只替换两个字", "只替换两处词")
    .replace(
      "第二段包含甲指标、乙指标、丙指标、丁指标和戊指标。",
      "第二段包含新甲口径、新乙口径、新丙口径、新丁口径和新戊口径。",
    )
    .replace("border-left: 2px solid #ddd", "border-left: 5px solid #6d5ce7")
    .replace(".locality-target { color: #556070; }", ".locality-target { color: #3548a8; }")
    .replaceAll(
      'style="color:#555;background:#fff;padding:4px;border:1px solid #ddd;width:320px"',
      'style="color:#333;background:#f3f4f6;padding:10px;border:3px solid #555;width:360px"',
    )
    .replace(ordinaryModule || "\u0000", "")
    .replace(TREND_BEFORE, TREND_AFTER)
    .replace(NOTE_BEFORE, NOTE_AFTER)
    .replace(jdCard ? `${jdCard}\n` : "\u0000", "")
    .replace(
      /(<div\b(?=[^>]*class="metric")(?=[^>]*data-report-metric="commerce")[^>]*>)/u,
      changedJdCard ? `${changedJdCard}\n        $1` : "$1",
    )
    .replace(tabPairBefore, tabPairAfter)
    .replace(
      '<p class="panel-title">核心结论</p>',
      '<div class="panel-head"><p class="panel-title">核心结论</p>'
      + '<p class="panel-caption">整体大盘 · 电商搜索 · 抖音份额</p></div>',
    )
    .replace(
      ".panel-title { margin: 0 0 10px;",
      ".panel-head { margin: 0 0 10px; }\n"
      + "      .panel-caption { margin: 2px 0 0; color: #8b8fa3; font-size: 12px; }\n"
      + "      .metric { border-left-width: 3px; border-left-color: #6d5ce7; }\n"
      + "      .metric[data-report-metric=\"overall\"] { padding-top: 18px; }\n"
      + "      .panel-title { margin: 0;",
    )
    .replace(
      "  </body>",
      `${ORDINARY_MODULE_AFTER}\n`
      + "    <aside data-review-edge-added style=\"position:absolute!important;right:0!important;top:900px!important;width:48px;height:32px\">"
      + "<span>边缘新增</span></aside>\n  </body>",
    );
}

async function addReportComment(page, sourcePath) {
  const active = await page.evaluate(
    () => window.htmlAIProjects?.getActiveProject(),
  );
  const frame = await loadedDiskFrame(page, active?.sourcePath || sourcePath);
  const target = frame.locator(caseSelector("list-item"));
  await page.keyboard.press("Escape");
  await frame.locator("body").click({ position: { x: 2, y: 2 } });
  await target.scrollIntoViewIfNeeded();
  await target.click();
  const commentButton = page.getByRole("button", { name: /给.+留评论/u })
    .filter({ visible: true })
    .first();
  await expect(commentButton).toBeVisible();
  await commentButton.click();
  const composer = page.getByRole("textbox", { name: "评论内容" });
  await composer.fill("把核心结论和趋势段落改写得更紧凑，其他地方保持不变。");
  const submitComment = page.getByRole("button", { name: "评论", exact: true });
  await expect(submitComment).toBeEnabled();
  // This spec exercises Review, not CommentRail pointer routing. The current
  // shell's scroll stage can transiently cover the fixed composer in native
  // hit-testing even though the button is visible and enabled, so invoke the
  // same button activation directly and keep the setup independent of that
  // unrelated geometry contract.
  await submitComment.evaluate((button) => button.click());
  await expect(composer).toBeHidden({ timeout: 45_000 });
  await expect(page.getByRole("complementary", { name: "本轮评论" }))
    .toHaveAttribute("data-layout-ready", "true", { timeout: 45_000 });
}

async function submitToAi(page, electronApp) {
  await electronApp.evaluate(({ clipboard }) => clipboard.clear());
  // The header opens the conversation; the destination and the copied state both live
  // inside it now, so the dialog over the page is gone.
  await page.getByRole("button", { name: /AI 助手/u }).click();
  await chooseClipboardDelivery(page);
  await expect(page.getByTestId("ai-conversation-action-bar"))
    .toContainText("任务已复制，等你的 AI 改完");
  let promptPath = "";
  await expect.poll(async () => {
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    promptPath = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u)?.[1] || "";
    return Boolean(promptPath && existsSync(promptPath));
  }, { timeout: 20_000 }).toBe(true);
  const requestRoot = path.dirname(promptPath);
  return {
    requestRoot,
    changeRequest: JSON.parse(
      readFileSync(path.join(requestRoot, "change-request.json"), "utf8"),
    ),
  };
}

function writeCandidate(requestRoot, changeRequest) {
  const base = readFileSync(
    path.join(requestRoot, "input", "base", "index.html"),
    "utf8",
  );
  const output = rewriteReport(base);
  if (output === base) throw new Error("The candidate rewrite matched the base byte for byte.");
  const requestRecord = JSON.parse(
    readFileSync(path.join(requestRoot, "request.json"), "utf8"),
  );
  const controlRoot = path.dirname(path.dirname(requestRoot));
  const outputPath = path.resolve(
    controlRoot,
    ...requestRecord.outputRelativePath.split("/"),
  );
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, "utf8");
  const command = changeRequest.finalization?.finalizerCommand
    || readFileSync(path.join(requestRoot, "PROMPT.md"), "utf8")
      .match(/```sh\s*\r?\n([^\r\n]+)\r?\n```/u)?.[1];
  const result = spawnSync("/bin/zsh", ["-lc", command], {
    cwd: requestRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`Finalizer failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** Everything the projection layer actually painted, in page coordinates. */
async function readProjection(frame) {
  return frame.locator("html").evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")]
      .map((box) => {
        const labelElement = box.querySelector("[data-pageroot-review-overlay-label]");
        return {
          changeId: box.getAttribute("data-pageroot-review-overlay-box") || "",
          owner: box.getAttribute("data-pageroot-review-semantic-owner") || "",
          fact: box.getAttribute("data-pageroot-review-fact") || "",
          path: box.getAttribute("data-path") || "",
          tone: box.dataset.tone || "",
          types: box.dataset.types || "",
          scope: box.dataset.scope || "",
          summary: box.dataset.summary || "",
          active: box.dataset.active || "",
          label: labelElement?.textContent || "",
          labelVisible: labelElement
            ? getComputedStyle(labelElement).visibility !== "hidden"
              && Number(getComputedStyle(labelElement).opacity) > 0
            : false,
          labelCount: Number(labelElement
            ?.getAttribute("data-pageroot-review-label-count") || 1),
          borderWidth: Number.parseFloat(getComputedStyle(box).borderTopWidth || "0"),
          borderColor: getComputedStyle(box).borderTopColor || "",
          left: Number(box.getAttribute("data-left")),
          top: Number(box.getAttribute("data-top")),
          width: Number(box.getAttribute("data-width")),
          height: Number(box.getAttribute("data-height")),
        };
      });
    const holes = [...document.querySelectorAll("[data-pageroot-review-mask-hole]")]
      .map((hole) => ({
        changeId: hole.getAttribute("data-pageroot-review-mask-hole") || "",
        owner: hole.getAttribute("data-pageroot-review-semantic-owner") || "",
        fact: hole.getAttribute("data-pageroot-review-fact") || "",
        path: hole.getAttribute("d") || "",
        left: Number(hole.getAttribute("data-left")),
        top: Number(hole.getAttribute("data-top")),
        width: Number(hole.getAttribute("data-width")),
        height: Number(hole.getAttribute("data-height")),
      }));
    const bars = [...document.querySelectorAll("[data-pageroot-review-region-bar]")]
      .map((bar) => ({
        changeId: bar.getAttribute("data-pageroot-review-region-bar") || "",
        active: bar.dataset.active || "",
        top: Number(bar.getAttribute("data-top")),
        height: Number(bar.getAttribute("data-height")),
      }));
    const strikes = [...document.querySelectorAll('[data-pageroot-review-text-mark="removed"]')]
      .map((line) => ({
        dashArray: line.getAttribute("stroke-dasharray") || "",
        thickness: Number(line.getAttribute("stroke-width")),
        y: Number(line.getAttribute("y1")),
      }));
    const dots = [...document.querySelectorAll('[data-pageroot-review-text-mark="added"]')]
      .map((dot) => ({
        x: Number(dot.getAttribute("cx")),
        y: Number(dot.getAttribute("cy")),
        radius: Number(dot.getAttribute("r")),
      }));
    // Which character each dot sits under, resolved from the live layout.
    const scroll = { x: scrollX, y: scrollY };
    const marked = [...document.querySelectorAll("[data-pageroot-review-text]")]
      .map((marker) => ({
        tone: marker.getAttribute("data-pageroot-review-text") || "",
        owner: marker.parentElement?.className || "",
        text: marker.textContent || "",
      }));
    const glyphs = [];
    document.querySelectorAll('[data-pageroot-review-text="added"]').forEach((marker) => {
      const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const value = node.textContent || "";
        for (let index = 0; index < value.length; index += 1) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const rect = range.getBoundingClientRect();
          range.detach();
          if (rect.width > 0.5) {
            glyphs.push({
              character: value[index],
              centerX: rect.left + scroll.x + rect.width / 2,
              bottom: rect.bottom + scroll.y,
            });
          }
        }
        node = walker.nextNode();
      }
    });
    const maskLayer = document.querySelector("[data-pageroot-review-mask-layer]");
    return {
      boxes,
      holes,
      bars,
      strikes,
      dots,
      glyphs,
      marked,
      documentWidth: Math.max(innerWidth, document.documentElement.scrollWidth),
      documentHeight: Math.max(innerHeight, document.documentElement.scrollHeight),
      authoredDocumentWidth: Number(maskLayer?.getAttribute("width")),
      authoredDocumentHeight: Number(maskLayer?.getAttribute("height")),
    };
  });
}

async function activeFootprintVisibleInOuterViewport(page, frame, side) {
  const footprint = await frame.locator(
    '[data-pageroot-review-overlay-box][data-active="true"]',
  ).first().evaluate((box) => ({
    left: Number(box.getAttribute("data-left")),
    right: Number(box.getAttribute("data-left")) + Number(box.getAttribute("data-width")),
    top: Number(box.getAttribute("data-top")),
    bottom: Number(box.getAttribute("data-top")) + Number(box.getAttribute("data-height")),
    scrollTop: scrollY,
    viewportHeight: innerHeight,
  })).catch(() => null);
  if (!footprint) return true;
  if (
    footprint.bottom <= footprint.scrollTop
    || footprint.top >= footprint.scrollTop + footprint.viewportHeight
  ) return false;
  return page.locator(`[aria-label="${side === "before" ? "修改前" : "修改后"}画布滚动区"]`)
    .evaluate((viewport, geometry) => {
      const frameElement = viewport.querySelector("iframe");
      if (!frameElement || frameElement.offsetWidth <= 0) return false;
      const scale = frameElement.getBoundingClientRect().width / frameElement.offsetWidth;
      const left = geometry.left * scale;
      const right = geometry.right * scale;
      return right > viewport.scrollLeft
        && left < viewport.scrollLeft + viewport.clientWidth;
    }, footprint);
}

async function focusGroupForFact(frame, selector, predicate) {
  return frame.locator(selector).evaluate((root, expected) => {
    const elements = [
      root,
      ...root.querySelectorAll("[data-pageroot-review-projection-facts]"),
    ];
    for (const element of elements) {
      const facts = JSON.parse(
        element.getAttribute("data-pageroot-review-projection-facts") || "[]",
      );
      const fact = facts.find((candidate) => Object.entries(expected).every(
        ([key, value]) => candidate[key] === value,
      ));
      if (!fact) continue;
      const changeId = element.getAttribute("data-pageroot-review-marker") || "";
      const id = fact.structureChange === "style"
        ? `focus-${fact.displayGroupId}`
        : `focus-${changeId}-${fact.displayGroupId}`;
      return { id, changeId, displayGroupId: fact.displayGroupId };
    }
    return null;
  }, predicate);
}

async function activateFocusGroup(beforeFrame, afterFrame, group) {
  expect(group).toBeTruthy();
  await expect.poll(async () => afterFrame.locator(
    "[data-pageroot-review-region-bar][data-pageroot-review-focus-group]",
  ).evaluateAll((bars) => bars.map((bar) => (
    bar.getAttribute("data-pageroot-review-focus-group") || ""
  )))).toContain(group.id);
  await afterFrame.locator(
    `[data-pageroot-review-region-bar][data-pageroot-review-focus-group="${group.id}"]`,
  ).first().evaluate((bar) => bar.click());
  await expect.poll(async () => Promise.all([beforeFrame, afterFrame].map((frame) => (
    frame.locator("html").getAttribute("data-pageroot-review-focus-group")
  )))).toEqual([group.id, group.id]);
}

async function captureAuthoredElement(frame, selector) {
  return frame.locator(selector).screenshot({
    animations: "disabled",
    style: `
      [data-pageroot-review-overlay-box],
      [data-pageroot-review-text-marks],
      [data-pageroot-review-region-bar] {
        visibility: hidden !important;
      }
    `,
  });
}

async function comparePngPixels(page, left, right) {
  return page.evaluate(async ({ leftBase64, rightBase64 }) => {
    const decode = async (base64) => {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      bitmap.close();
      return { width: canvas.width, height: canvas.height, pixels };
    };
    const [leftImage, rightImage] = await Promise.all([
      decode(leftBase64),
      decode(rightBase64),
    ]);
    if (
      leftImage.width !== rightImage.width
      || leftImage.height !== rightImage.height
    ) return { dimensionsMatch: false };
    let changedPixels = 0;
    let channelDelta = 0;
    let maxChannelDelta = 0;
    for (let offset = 0; offset < leftImage.pixels.length; offset += 4) {
      let pixelChanged = false;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(
          leftImage.pixels[offset + channel] - rightImage.pixels[offset + channel],
        );
        channelDelta += delta;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta > 0) pixelChanged = true;
      }
      if (pixelChanged) changedPixels += 1;
    }
    const pixelCount = leftImage.width * leftImage.height;
    return {
      dimensionsMatch: true,
      changedPixelRatio: changedPixels / pixelCount,
      meanChannelDelta: channelDelta / (pixelCount * 3),
      maxChannelDelta,
    };
  }, {
    leftBase64: left.toString("base64"),
    rightBase64: right.toString("base64"),
  });
}

test("the review projection annotates a dense report cleanly and accurately", async () => {
  test.setTimeout(240_000);
  const fixture = createSourceFixture({
    fileName: "review-annotation-report.html",
    sourceFixtureName: "review-annotation-report.html",
    sourceDirectoryPrefix: SOURCE_PREFIX,
  });
  const launched = await launchPageRoot({
    userDataPrefix: USER_DATA_PREFIX,
    activeSourcePath: fixture.sourcePath,
  });
  try {
    await addReportComment(launched.page, fixture.sourcePath);
    const request = await submitToAi(launched.page, launched.electronApp);
    writeCandidate(request.requestRoot, request.changeRequest);
    const openReviewButton = launched.page.getByRole("button", { name: "审阅对比" });
    await expect(openReviewButton).toBeVisible({ timeout: 30_000 });
    await openReviewButton.click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const liveReviewTools = launched.page.locator("header.workbench-header")
      .getByLabel("审阅工具", { exact: true });
    await expect(liveReviewTools).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "收起审阅工具" }))
      .toHaveCount(0);
    const beforeFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    await expect.poll(
      async () => afterFrame.locator("[data-pageroot-review-region-bar]").count(),
      { timeout: 30_000 },
    ).toBeGreaterThan(0);
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator("[data-pageroot-review-overlay-box]")).toHaveCount(0);
      await expect(frame.locator("[data-pageroot-review-mask-hole]")).toHaveCount(0);
      await expect(frame.locator("[data-pageroot-review-mask-dim]")).toHaveCount(0);
    }
    const captureDirectory = path.join(productRoot, "output", "design-qa");
    mkdirSync(captureDirectory, { recursive: true });
    await launched.page.screenshot({
      path: path.join(captureDirectory, "review-focus-overview.png"),
      animations: "disabled",
    });
    const overviewEvidence = {
      before: await readProjection(beforeFrame),
      after: await readProjection(afterFrame),
    };
    const paragraphOneGroup = await focusGroupForFact(
      afterFrame,
      "[data-review-paragraph-one]",
      { type: "text" },
    );
    const paragraphTwoGroup = await focusGroupForFact(
      afterFrame,
      "[data-review-paragraph-two]",
      { type: "text" },
    );
    expect(paragraphOneGroup.id).not.toBe(paragraphTwoGroup.id);
    const paragraphScrollTops = [];
    for (const [index, group] of [paragraphOneGroup, paragraphTwoGroup].entries()) {
      await activateFocusGroup(beforeFrame, afterFrame, group);
      for (const frame of [beforeFrame, afterFrame]) {
        const boxes = frame.locator(
          `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${group.id}"]`,
        );
        await expect(boxes).toHaveCount(1);
        await expect(boxes).toHaveAttribute("data-scope", "text-block");
        await expect(boxes.locator("[data-pageroot-review-overlay-label]")).toHaveCount(1);
        await expect(boxes.locator("[data-pageroot-review-overlay-label]")).not.toContainText("×");
        await expect(frame.locator("[data-pageroot-review-overlay-box]")).toHaveCount(1);
        await expect(frame.locator("[data-pageroot-review-mask-hole]")).toHaveCount(1);
      }
      const selector = index === 0 ? "[data-review-paragraph-one]" : "[data-review-paragraph-two]";
      await expect.poll(() => afterFrame.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight;
      })).toBe(true);
      paragraphScrollTops.push(await afterFrame.locator("html").evaluate(() => scrollY));
      await launched.page.screenshot({
        path: path.join(captureDirectory, `review-focus-paragraph-${index + 1}.png`),
        animations: "disabled",
      });
    }
    expect(paragraphScrollTops[1] - paragraphScrollTops[0]).toBeGreaterThan(100);
    await launched.page.evaluate(() => {
      for (const [id, value] of [
        ["review-bare-editable", ""],
        ["review-plaintext-editable", "plaintext-only"],
      ]) {
        const editable = document.createElement("p");
        editable.id = id;
        editable.setAttribute("contenteditable", value);
        editable.textContent = id;
        document.body.append(editable);
      }
    });
    for (const selector of ["#review-bare-editable", "#review-plaintext-editable"]) {
      await launched.page.locator(selector).press("Escape");
      for (const frame of [beforeFrame, afterFrame]) {
        await expect(frame.locator("html"))
          .toHaveAttribute("data-pageroot-review-focus-group", paragraphTwoGroup.id);
      }
    }
    await launched.page.evaluate(() => {
      document.querySelector("#review-bare-editable")?.remove();
      document.querySelector("#review-plaintext-editable")?.remove();
    });
    await launched.page.getByRole("button", { name: "采纳修改" }).click();
    const confirmationDialog = launched.page.getByRole("dialog");
    await expect(confirmationDialog).toBeVisible();
    await confirmationDialog.getByRole("button", { name: "继续审阅" }).press("Escape");
    await expect(confirmationDialog).toBeHidden();
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator("html"))
        .toHaveAttribute("data-pageroot-review-focus-group", paragraphTwoGroup.id);
    }
    await afterFrame.locator("body").press("Escape");
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator("html"))
        .toHaveAttribute("data-pageroot-review-focus-group", "");
      await expect(frame.locator("[data-pageroot-review-overlay-box]")).toHaveCount(0);
      await expect(frame.locator("[data-pageroot-review-mask-dim]")).toHaveCount(0);
    }
    const cssGroup = await focusGroupForFact(
      afterFrame,
      '.metric[data-report-metric="overall"]',
      { type: "structure", structureChange: "style" },
    );
    await activateFocusGroup(beforeFrame, afterFrame, cssGroup);
    for (const frame of [beforeFrame, afterFrame]) {
      const cssBox = frame.locator(
        `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${cssGroup.id}"]`,
      );
      await expect(cssBox).toHaveCount(1);
      await expect(cssBox).toHaveAttribute("data-scope", "container");
      await expect(cssBox.locator("[data-pageroot-review-overlay-label]")).toHaveCount(1);
      await expect(frame.locator("[data-pageroot-review-mask-hole]")).toHaveCount(1);
      await expect.poll(() => cssBox.evaluate((box) => {
        const grid = document.querySelector(".metrics");
        if (!grid) return false;
        const boxRect = box.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        return Math.abs(boxRect.left - (gridRect.left - 3)) < .75
          && Math.abs(boxRect.top - (gridRect.top - 3)) < .75
          && Math.abs(boxRect.width - (gridRect.width + 6)) < .75
          && Math.abs(boxRect.height - (gridRect.height + 6)) < .75;
      })).toBe(true);
    }
    await launched.page.screenshot({
      path: path.join(captureDirectory, "review-focus-css-grid.png"),
      animations: "disabled",
    });
    const firstLocalityGroup = await focusGroupForFact(
      afterFrame,
      '[data-review-locality-grid="one"] .locality-target',
      { type: "structure", structureChange: "style" },
    );
    const secondLocalityGroup = await focusGroupForFact(
      afterFrame,
      '[data-review-locality-grid="two"] .locality-target',
      { type: "structure", structureChange: "style" },
    );
    expect(secondLocalityGroup.id).toBe(firstLocalityGroup.id);
    expect(secondLocalityGroup.displayGroupId).toBe(firstLocalityGroup.displayGroupId);
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator(
        `[data-pageroot-review-region-bar][data-pageroot-review-focus-group="${firstLocalityGroup.id}"]`,
      )).toHaveCount(2);
    }
    await activateFocusGroup(beforeFrame, afterFrame, firstLocalityGroup);
    for (const frame of [beforeFrame, afterFrame]) {
      const localityBoxes = frame.locator(
        `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${firstLocalityGroup.id}"]`,
      );
      await expect(localityBoxes).toHaveCount(2);
      await expect(localityBoxes.locator("[data-pageroot-review-overlay-label]"))
        .toHaveCount(1);
      await expect(frame.locator("[data-pageroot-review-mask-hole]"))
        .toHaveCount(2);
    }
    const singleCardCssGroup = await afterFrame.locator(
      '.metric[data-report-metric="overall"]',
    ).evaluate((element, excludedDisplayGroupId) => {
      const fact = JSON.parse(
        element.getAttribute("data-pageroot-review-projection-facts") || "[]",
      ).find((candidate) => (
        candidate.type === "structure"
        && candidate.structureChange === "style"
        && candidate.displayGroupId?.startsWith("display-css-")
        && candidate.displayGroupId !== excludedDisplayGroupId
      ));
      return fact ? {
        id: `focus-${fact.displayGroupId}`,
        changeId: element.getAttribute("data-pageroot-review-marker") || "",
        displayGroupId: fact.displayGroupId,
      } : null;
    }, cssGroup.displayGroupId);
    await activateFocusGroup(beforeFrame, afterFrame, singleCardCssGroup);
    for (const frame of [beforeFrame, afterFrame]) {
      const cardBox = frame.locator(
        `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${singleCardCssGroup.id}"]`,
      );
      await expect(cardBox).toHaveCount(1);
      await expect.poll(() => cardBox.evaluate((box) => {
        const card = document.querySelector('.metric[data-report-metric="overall"]');
        if (!card) return false;
        const boxRect = box.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        return Math.abs(boxRect.left - (cardRect.left - 3)) < .75
          && Math.abs(boxRect.top - (cardRect.top - 3)) < .75
          && Math.abs(boxRect.width - (cardRect.width + 6)) < .75
          && Math.abs(boxRect.height - (cardRect.height + 6)) < .75;
      })).toBe(true);
    }
    await launched.page.screenshot({
      path: path.join(captureDirectory, "review-focus-single-card.png"),
      animations: "disabled",
    });
    const singleStyleGroup = await focusGroupForFact(
      afterFrame,
      "[data-review-single-style]",
      { type: "structure", structureChange: "style" },
    );
    await activateFocusGroup(beforeFrame, afterFrame, singleStyleGroup);
    for (const frame of [beforeFrame, afterFrame]) {
      const singleBox = frame.locator(
        `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${singleStyleGroup.id}"]`,
      );
      await expect(singleBox).toHaveCount(1);
      await expect.poll(() => singleBox.evaluate((box) => {
        const owner = document.querySelector("[data-review-single-style]");
        if (!owner) return false;
        const boxRect = box.getBoundingClientRect();
        const ownerRect = owner.getBoundingClientRect();
        return Math.abs(boxRect.left - (ownerRect.left - 3)) < .75
          && Math.abs(boxRect.top - (ownerRect.top - 3)) < .75
          && Math.abs(boxRect.width - (ownerRect.width + 6)) < .75
          && Math.abs(boxRect.height - (ownerRect.height + 6)) < .75;
      })).toBe(true);
    }
    await launched.page.screenshot({
      path: path.join(captureDirectory, "review-focus-inline-element.png"),
      animations: "disabled",
    });
    const inlineStyleGroupA = await focusGroupForFact(
      afterFrame,
      "[data-review-inline-a]",
      { type: "structure", structureChange: "style" },
    );
    const inlineStyleGroupB = await focusGroupForFact(
      afterFrame,
      "[data-review-inline-b]",
      { type: "structure", structureChange: "style" },
    );
    expect(inlineStyleGroupA.id).not.toBe(inlineStyleGroupB.id);
    for (const frame of [beforeFrame, afterFrame]) {
      await frame.locator("head").evaluate((head) => {
        const authoredStyle = document.createElement("style");
        authoredStyle.textContent = `
          svg rect,
          [data-pageroot-review-mask-dim] {
            backdrop-filter: grayscale(1) blur(3px) !important;
            -webkit-backdrop-filter: grayscale(1) blur(3px) !important;
          }
        `;
        head.append(authoredStyle);
      });
    }
    await activateFocusGroup(beforeFrame, afterFrame, inlineStyleGroupA);
    for (const frame of [beforeFrame, afterFrame]) {
      const inlineBox = frame.locator(
        `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${inlineStyleGroupA.id}"]`,
      );
      await expect(inlineBox).toHaveCount(1);
      await expect(frame.locator(
        `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${inlineStyleGroupB.id}"]`,
      )).toHaveCount(0);
      await expect(frame.locator("[data-pageroot-review-mask-hole]")).toHaveCount(1);
      await expect(frame.locator("[data-pageroot-review-mask-dim]")).toHaveCSS(
        "backdrop-filter",
        "none",
      );
      await expect.poll(() => inlineBox.evaluate((box) => {
        const paragraph = document.querySelector("[data-review-inline-a]");
        if (!paragraph) return false;
        const boxRect = box.getBoundingClientRect();
        const paragraphRect = paragraph.getBoundingClientRect();
        return Math.abs(boxRect.left - (paragraphRect.left - 3)) < .75
          && Math.abs(boxRect.top - (paragraphRect.top - 3)) < .75
          && Math.abs(boxRect.width - (paragraphRect.width + 6)) < .75
          && Math.abs(boxRect.height - (paragraphRect.height + 6)) < .75;
      })).toBe(true);
    }
    await launched.page.screenshot({
      path: path.join(captureDirectory, "review-focus-inline-isolated.png"),
      animations: "disabled",
    });
    const focusedInsidePixels = await Promise.all([beforeFrame, afterFrame].map(
      (frame) => captureAuthoredElement(frame, "[data-review-inline-a]"),
    ));
    const focusedOutsidePixels = await Promise.all([beforeFrame, afterFrame].map(
      (frame) => captureAuthoredElement(frame, "[data-review-single-style]"),
    ));
    await afterFrame.locator(
      `[data-pageroot-review-region-bar][data-pageroot-review-focus-group="${inlineStyleGroupA.id}"]`,
    ).first().evaluate((bar) => bar.click());
    await expect.poll(async () => Promise.all([beforeFrame, afterFrame].map((frame) => (
      frame.locator("html").getAttribute("data-pageroot-review-focus-group")
    )))).toEqual(["", ""]);
    const overviewInsidePixels = await Promise.all([beforeFrame, afterFrame].map(
      (frame) => captureAuthoredElement(frame, "[data-review-inline-a]"),
    ));
    const overviewOutsidePixels = await Promise.all([beforeFrame, afterFrame].map(
      (frame) => captureAuthoredElement(frame, "[data-review-single-style]"),
    ));
    for (const [index, focusedPixels] of focusedInsidePixels.entries()) {
      const insideComparison = await comparePngPixels(
        launched.page,
        focusedPixels,
        overviewInsidePixels[index],
      );
      const outsideComparison = await comparePngPixels(
        launched.page,
        focusedOutsidePixels[index],
        overviewOutsidePixels[index],
      );
      expect(insideComparison.dimensionsMatch).toBe(true);
      expect(outsideComparison.dimensionsMatch).toBe(true);
      // Locator screenshots can shift glyph antialiasing by a fraction after
      // focus navigation, so compare decoded pixels with a narrow tolerance.
      // The active region must remain visually unchanged while its surrounding
      // context is materially faded.
      expect(insideComparison.meanChannelDelta).toBeLessThan(.75);
      expect(outsideComparison.meanChannelDelta).toBeGreaterThan(2);
      expect(outsideComparison.meanChannelDelta).toBeGreaterThan(
        insideComparison.meanChannelDelta * 5,
      );
    }
    await activateFocusGroup(beforeFrame, afterFrame, paragraphTwoGroup);
    await expect(launched.page.getByRole("button", { name: "原始大小", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => Promise.all([
      activeFootprintVisibleInOuterViewport(launched.page, beforeFrame, "before"),
      activeFootprintVisibleInOuterViewport(launched.page, afterFrame, "after"),
    ]).then((visible) => visible.every(Boolean)), { timeout: 30_000 }).toBe(true);

    const activePathsMatch = (frame) => frame.locator("html").evaluate(() => {
      const boxes = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")]
        .map((box) => box.getAttribute("data-path") || "").sort();
      const holes = [...document.querySelectorAll("[data-pageroot-review-mask-hole]")]
        .map((hole) => hole.getAttribute("d") || "").sort();
      return boxes.length > 0 && JSON.stringify(boxes) === JSON.stringify(holes);
    });
    for (const frame of [beforeFrame, afterFrame]) {
      await frame.locator("html").evaluate(async () => {
        const style = document.createElement("style");
        style.id = "review-dynamic-font-test";
        style.textContent = "body, body * { font-family: Menlo, monospace !important; }";
        document.head.append(style);
        await document.fonts?.ready;
        dispatchEvent(new Event("resize"));
      });
    }
    await expect.poll(async () => Promise.all([
      activePathsMatch(beforeFrame),
      activePathsMatch(afterFrame),
    ]).then((matches) => matches.every(Boolean))).toBe(true);
    for (const frame of [beforeFrame, afterFrame]) {
      await frame.locator("html").evaluate(() => {
        document.getElementById("review-dynamic-font-test")?.remove();
        dispatchEvent(new Event("resize"));
      });
    }
    await expect.poll(async () => Promise.all([
      activePathsMatch(beforeFrame),
      activePathsMatch(afterFrame),
    ]).then((matches) => matches.every(Boolean))).toBe(true);

    await launched.page.screenshot({
      path: path.join(captureDirectory, "review-annotation-all.png"),
      animations: "disabled",
    });
    if (process.env.PAGEROOT_CAPTURE_TOOLBAR_CLEANUP) {
      const visibleToast = launched.page.locator(".toast.show");
      await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
      if (await visibleToast.isVisible().catch(() => false)) {
        await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
        await expect(visibleToast).toBeHidden();
      }
      const toolbarCaptureDirectory = path.resolve(
        productRoot,
        process.env.PAGEROOT_CAPTURE_TOOLBAR_CLEANUP_DIR
          || path.join("output", "design-qa", "toolbar-cleanup"),
      );
      mkdirSync(toolbarCaptureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(toolbarCaptureDirectory, "05-review-toolbar.png"),
        animations: "disabled",
      });
    }

    const projections = {
      before: await readProjection(beforeFrame),
      after: await readProjection(afterFrame),
    };
    for (const [side, projection] of Object.entries(projections)) {
      expect(
        projection.documentWidth,
        `${side}: projection chrome must not widen the authored document`,
      ).toBeLessThanOrEqual(projection.authoredDocumentWidth + 0.01);
      expect(projection.holes.length, `${side}: active outlines and holes share one record set`)
        .toBe(projection.boxes.length);
      expect(
        projection.boxes.filter((box) => box.labelVisible).length,
        `${side}: one active focus group has at most one label`,
      ).toBeLessThanOrEqual(1);
      expect(projection.boxes.every((box) => !box.label.includes("×"))).toBe(true);
      projection.holes.forEach((hole) => {
        const box = projection.boxes.find((candidate) => (
          candidate.changeId === hole.changeId
          && candidate.owner === hole.owner
          && candidate.fact === hole.fact
        ));
        expect(box, `${side}: every emphasized mask hole needs a canonical box`).toBeTruthy();
        expect(box.active, `${side}: only active focus records cut mask holes`).toBe("true");
        for (const [kind, geometry] of [["box", box], ["hole", hole]]) {
          expect(geometry.left, `${side}: ${kind} ${box.changeId} crosses the left edge`)
            .toBeGreaterThanOrEqual(0);
          expect(geometry.top, `${side}: ${kind} ${box.changeId} crosses the top edge`)
            .toBeGreaterThanOrEqual(0);
          expect(
            geometry.left + geometry.width,
            `${side}: ${kind} ${box.changeId} crosses the right edge`,
          ).toBeLessThanOrEqual(projection.authoredDocumentWidth);
          expect(
            geometry.top + geometry.height,
            `${side}: ${kind} ${box.changeId} crosses the bottom edge`,
          ).toBeLessThanOrEqual(projection.authoredDocumentHeight);
        }
        expect(hole.left, `${side}: box/hole left`).toBeCloseTo(box.left, 5);
        expect(hole.top, `${side}: box/hole top`).toBeCloseTo(box.top, 5);
        expect(hole.width, `${side}: box/hole width`).toBeCloseTo(box.width, 5);
        expect(hole.height, `${side}: box/hole height`).toBeCloseTo(box.height, 5);
        expect(hole.path, `${side}: box/hole canonical path`)
          .toBe(box.path);
      });
    }
    for (const [side, frame] of [["before", beforeFrame], ["after", afterFrame]]) {
      expect(
        await frame.locator(".tabs .tab[data-pageroot-review-structure]").count(),
        `${side}: ambiguous reorder must not guess one tab`,
      ).toBe(0);
      await expect(frame.locator(".tabs"))
        .toHaveAttribute("data-pageroot-review-structure", "reordered");
    }
    for (const [side, frame] of [["before", beforeFrame], ["after", afterFrame]]) {
      await expect(frame.locator(".metrics"))
        .toHaveAttribute("data-pageroot-review-structure", "reordered");
      const jdEvidence = await frame.locator('[data-report-metric="jd-retail-profit"]')
        .evaluate((card) => {
          const markerText = [...card.querySelectorAll("[data-pageroot-review-text]")]
            .map((marker) => marker.textContent || "").join("");
          const note = card.querySelector("[data-review-jd-note]");
          return {
            cardStructure: JSON.parse(
              card.getAttribute("data-pageroot-review-projection-facts") || "[]",
            ).filter((fact) => fact.type === "structure")
              .map((fact) => fact.structureChange),
            stableCopyMarked: ["京东零售经营利润", "135", "-3.3%"]
              .some((value) => markerText.includes(value)),
            noteStructure: note?.getAttribute("data-pageroot-review-structure") || "",
            descendantStructure: note?.querySelectorAll("[data-pageroot-review-structure]").length || 0,
            descendantText: note?.querySelectorAll("[data-pageroot-review-text]").length || 0,
          };
        });
      expect(jdEvidence.cardStructure, `${side}: ambiguous sibling order stays on the parent`)
        .toEqual(["style"]);
      expect(jdEvidence.stableCopyMarked, `${side}: stable JD title/value must not be text evidence`)
        .toBe(false);
      expect(jdEvidence.noteStructure, `${side}: only the changed bottom wrapper is structural`)
        .toBe("attribute");
      expect(jdEvidence.descendantStructure, `${side}: list items retain their concrete presence facts`)
        .toBe(side === "before" ? 0 : 2);
      expect(jdEvidence.descendantText, `${side}: JD bottom subtree has duplicate text facts`)
        .toBe(0);
    }
    for (const [side, frame] of [["before", beforeFrame], ["after", afterFrame]]) {
      const ordinary = await frame.locator("[data-review-ordinary-replacement]")
        .evaluate((element) => ({
          structure: element.getAttribute("data-pageroot-review-structure") || "",
          descendantText: element.querySelectorAll("[data-pageroot-review-text]").length,
          descendantStructure: element.querySelectorAll("[data-pageroot-review-structure]").length,
        }));
      expect(ordinary.structure, `${side}: ordinary titled div must not earn relocation identity`)
        .toBe(side === "before" ? "removed" : "added");
      expect(ordinary.descendantText, `${side}: unmatched ordinary div repeats text facts`).toBe(0);
      expect(ordinary.descendantStructure, `${side}: unmatched ordinary div repeats structure facts`).toBe(0);
    }
    const edgeChangeId = await afterFrame.locator("[data-review-edge-added]")
      .getAttribute("data-pageroot-review-marker");
    const edgeDisplayGroupId = await afterFrame.locator("[data-review-edge-added]")
      .evaluate((element) => JSON.parse(
        element.getAttribute("data-pageroot-review-projection-facts") || "[]",
      )[0]?.displayGroupId || "");
    const edgeFocusGroupId = `focus-${edgeChangeId}-${edgeDisplayGroupId}`;
    await afterFrame.locator(
      `[data-pageroot-review-region-bar][data-pageroot-review-focus-group="${edgeFocusGroupId}"]`,
    ).first().evaluate((bar) => bar.click());
    await expect(afterFrame.locator("html"))
      .toHaveAttribute("data-pageroot-review-focus-group", edgeFocusGroupId);
    await expect(beforeFrame.locator("html"))
      .toHaveAttribute("data-pageroot-review-focus-group", edgeFocusGroupId);
    await expect(afterFrame.locator(
      `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${edgeFocusGroupId}"]`,
    )).toHaveCount(1);
    await expect(beforeFrame.locator(
      `[data-pageroot-review-overlay-box][data-pageroot-review-focus-group="${edgeFocusGroupId}"]`,
    )).toHaveCount(0);
    await expect(beforeFrame.locator("[data-pageroot-review-mask-dim]")).toHaveCount(0);
    const edgeProjection = await readProjection(afterFrame);
    const edgeBox = edgeProjection.boxes.find((box) => (
      box.changeId === edgeChangeId
      && box.types.includes("structure")
    ));
    expect(edgeBox, "right-edge addition must produce one structural footprint").toBeTruthy();
    const edgeElementGeometry = await afterFrame.locator("[data-review-edge-added]")
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left + scrollX,
          right: rect.right + scrollX,
          position: getComputedStyle(element).position,
          authoredStyle: element.getAttribute("style") || "",
        };
      });
    expect(
      edgeBox.left + edgeBox.width,
      `right-edge structural footprint must clamp to the authored edge: ${JSON.stringify({ edgeBox, edgeElementGeometry })}`,
    ).toBeCloseTo(edgeProjection.authoredDocumentWidth, 5);
    await launched.page.screenshot({
      path: path.join(captureDirectory, "review-focus-one-sided.png"),
      animations: "disabled",
    });

    expect(edgeChangeId).toBeTruthy();
    const outerViewports = {
      before: launched.page.getByLabel("修改前画布滚动区", { exact: true }),
      after: launched.page.getByLabel("修改后画布滚动区", { exact: true }),
    };
    await Promise.all(Object.values(outerViewports).map((viewport) => (
      viewport.evaluate((element) => { element.scrollLeft = 0; })
    )));
    await afterFrame.locator(
      `[data-pageroot-review-overlay-box="${edgeChangeId}"] [data-pageroot-review-overlay-label]`,
    ).evaluate((label) => label.click());
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator("html"))
        .toHaveAttribute("data-pageroot-review-focus-group", "");
      await expect(frame.locator("[data-pageroot-review-overlay-box]")).toHaveCount(0);
      await expect(frame.locator("[data-pageroot-review-mask-dim]")).toHaveCount(0);
    }
    const missingSideState = () => beforeFrame.locator("html").evaluate(() => ({
      scrollY,
      panels: [...document.querySelectorAll("[data-pageroot-review-panel-container]")]
        .map((panel) => ({
          hidden: panel.hidden,
          ariaHidden: panel.getAttribute("aria-hidden"),
        })),
      details: [...document.querySelectorAll("details")]
        .map((details) => details.open),
    }));
    const missingSideBeforeActivation = await missingSideState();
    await afterFrame.locator(
      `[data-pageroot-review-region-bar][data-pageroot-review-focus-group="${edgeFocusGroupId}"]`,
    ).first().evaluate((bar) => bar.click());
    await expect.poll(() => outerViewports.before.evaluate((element) => element.scrollLeft))
      .toBe(0);
    await expect.poll(missingSideState).toEqual(missingSideBeforeActivation);
    await expect.poll(() => activeFootprintVisibleInOuterViewport(
      launched.page,
      afterFrame,
      "after",
    ), { timeout: 15_000 }).toBe(true);
    writeFileSync(
      path.join(captureDirectory, "review-annotation-projection.json"),
      JSON.stringify(projections, null, 2),
      "utf8",
    );

    // 1. One source fact draws one outline. Independent localized facts may
    //    coexist inside a parent reorder region, but duplicate geometry for
    //    the same fact/owner must still collapse.
    for (const [side, projection] of Object.entries(projections)) {
      for (const box of projection.boxes) {
        const container = projection.boxes.find((candidate) => (
          candidate !== box
          && candidate.changeId === box.changeId
          && candidate.fact === box.fact
          && candidate.owner === box.owner
          && !candidate.types.includes("text")
          && !box.types.includes("text")
          && box.left >= candidate.left - 1
          && box.top >= candidate.top - 1
          && box.left + box.width <= candidate.left + candidate.width + 1
          && box.top + box.height <= candidate.top + candidate.height + 1
          && candidate.width * candidate.height > box.width * box.height
        ));
        expect(
          container,
          `${side}: "${box.summary}" is nested inside "${container?.summary}" and must have been collapsed`,
        ).toBeUndefined();
        expect(box.borderWidth, `${side}: outlines must stay thin`).toBeLessThanOrEqual(4);
      }
      // Two independent outlines crossing around one semantic owner read as
      // noise. Text presentation is reading-block only.
      const stackedRun = (left, right) => (
        left.owner === right.owner
        && left.scope === "text-block"
        && right.scope === "text-block"
      );
      for (const box of projection.boxes) {
        const crossing = projection.boxes.find((candidate) => (
          candidate !== box
          && candidate.changeId === box.changeId
          && candidate.fact === box.fact
          && candidate.owner === box.owner
          && !stackedRun(box, candidate)
          && Math.min(box.left + box.width, candidate.left + candidate.width)
            - Math.max(box.left, candidate.left) > 0
          && Math.min(box.top + box.height, candidate.top + candidate.height)
            - Math.max(box.top, candidate.top) > 0
        ));
        expect(
          crossing,
          `${side}: "${box.summary}" at ${box.top} overlaps "${crossing?.summary}" at ${crossing?.top}`,
        ).toBeUndefined();
      }
    }

    // 1a. Focus renders only the active semantic group. It owns one public
    //     caption without an internal-fragment multiplier; navigation bars
    //     remain the overview index for all groups.
    for (const [side, projection] of Object.entries(projections)) {
      const captionsByChange = new Map();
      for (const box of projection.boxes) {
        expect(box.active, `${side}: rendered boxes belong to the active group`).toBe("true");
        if (!box.label) continue;
        expect(box.label.includes(" ×"), `${side}: focus label exposes fragment counts`)
          .toBe(false);
        captionsByChange.set(box.changeId, (captionsByChange.get(box.changeId) || 0) + 1);
      }
      const barsByChange = new Map();
      for (const bar of projection.bars) {
        barsByChange.set(bar.changeId, (barsByChange.get(bar.changeId) || 0) + 1);
      }
      expect([...captionsByChange.values()].reduce((sum, count) => sum + count, 0),
        `${side}: active focus must have at most one caption`).toBeLessThanOrEqual(1);
      for (const box of projection.boxes) {
        expect(
          barsByChange.has(box.changeId),
          `${side}: change ${box.changeId} has no revision bar`,
        ).toBe(true);
      }
      for (const bar of projection.bars) {
        expect(bar.height, `${side}: a revision bar collapsed to ${bar.height}px`)
          .toBeGreaterThan(4);
      }
    }

    // 1b. Focus claims exactly one semantic group; inactive groups have no box.
    await afterFrame.locator("[data-pageroot-review-region-bar]").first().click();
    await expect.poll(async () => {
      const sides = {
        before: await readProjection(beforeFrame),
        after: await readProjection(afterFrame),
      };
      const activeBoxes = [...sides.before.boxes, ...sides.after.boxes]
        .filter((box) => box.active === "true");
      if (!activeBoxes.length) return "no active box";
      const claimed = activeBoxes.every((box) => (
        box.borderColor === "rgb(109, 92, 231)"
      ));
      const noInactiveBoxes = [...sides.before.boxes, ...sides.after.boxes]
        .every((box) => box.active === "true");
      const barClaimed = [...sides.before.bars, ...sides.after.bars]
        .some((bar) => bar.active === "true");
      if (!claimed) return "active box lacks the canonical purple border";
      if (!noInactiveBoxes) return "an inactive group still rendered a box";
      if (!barClaimed) return "no active revision bar";
      return "ok";
    }, { timeout: 15_000 }).toBe("ok");

    // 2. The strike must read as a dashed rule. A round cap adds one stroke
    //    thickness to every dash and removes it from every gap.
    expect(overviewEvidence.before.strikes.length).toBeGreaterThan(0);
    for (const strike of overviewEvidence.before.strikes) {
      const [dash, gap] = strike.dashArray.split(" ").map(Number);
      expect(gap - strike.thickness, `dash pattern ${strike.dashArray} @ ${strike.thickness}px`)
        .toBeGreaterThan(1);
      expect(gap - strike.thickness).toBeGreaterThanOrEqual(dash + strike.thickness);
    }

    // 3. Green dots: exactly one per written character, centred on it, never on
    //    punctuation, and one shared baseline per rendered row.
    const dots = overviewEvidence.after.dots;
    expect(dots.length).toBeGreaterThan(0);
    const positions = new Set(dots.map((dot) => `${Math.round(dot.x)}|${Math.round(dot.y)}`));
    expect(positions.size, "a character must not be dotted twice").toBe(dots.length);
    const nearestGlyph = (dot) => overviewEvidence.after.glyphs
      .slice()
      .sort((left, right) => (
        Math.abs(left.centerX - dot.x) - Math.abs(right.centerX - dot.x)
      ))[0];
    for (const dot of dots) {
      const glyph = nearestGlyph(dot);
      expect(
        Math.abs(glyph.centerX - dot.x),
        `a dot at x=${dot.x} is not centred on "${glyph.character}"`,
      ).toBeLessThanOrEqual(0.75);
      expect(
        /[\p{P}\p{S}\s]/u.test(glyph.character),
        `"${glyph.character}" is punctuation or space and must carry no dot`,
      ).toBe(false);
      expect(dot.y).toBeGreaterThan(glyph.bottom - dot.radius * 2);
    }
    // One dot per written character and none anywhere else: the dot count must
    // equal the number of letters, digits and ideographs under the markers.
    const writtenGlyphs = overviewEvidence.after.glyphs.filter((glyph) => (
      !/[\p{P}\p{S}\s]/u.test(glyph.character)
    ));
    expect(dots.length, "every written character gets one dot and nothing else does")
      .toBe(writtenGlyphs.length);

    const rows = new Map();
    for (const dot of dots) {
      rows.set(Math.round(dot.y), (rows.get(Math.round(dot.y)) || 0) + 1);
    }
    const rowBaselines = [...rows.keys()].sort((left, right) => left - right);
    for (let index = 1; index < rowBaselines.length; index += 1) {
      expect(
        rowBaselines[index] - rowBaselines[index - 1],
        `baselines ${rowBaselines[index - 1]} and ${rowBaselines[index]} split one row in two`,
      ).toBeGreaterThan(2);
    }

    // 4. Text the reader can still see is neither struck through nor announced
    //    as new. The trend paragraph reuses most of its numbers.
    for (const [side, frame] of [["before", beforeFrame], ["after", afterFrame]]) {
      const marked = await frame.locator("[data-pageroot-review-text]")
        .evaluateAll((markers) => markers.map((marker) => marker.textContent).join(""));
      for (const survivor of ["96.2", "YoY", "+18%", "回落", "2pp", "结构变化加剧", "抖系份额收缩"]) {
        expect(
          marked.includes(survivor),
          `${side}: "${survivor}" is on both pages and must not be marked`,
        ).toBe(false);
      }
    }

    // 5. A wholly added or removed element is one structural fact. Descendant
    //    elements and their text never repeat that same subtree as extra marks.
    for (const [side, frame] of [["before", beforeFrame], ["after", afterFrame]]) {
      const nested = await frame.locator("html").evaluate(() => {
        const whollyChanged = [...document.querySelectorAll(
          '[data-pageroot-review-structure="added"], [data-pageroot-review-structure="removed"]',
        )];
        return {
          whollyChanged: whollyChanged.length,
          structure: whollyChanged.reduce((count, root) => (
            count + root.querySelectorAll("[data-pageroot-review-structure]").length
          ), 0),
          text: whollyChanged.reduce((count, root) => (
            count + root.querySelectorAll("[data-pageroot-review-text]").length
          ), 0),
        };
      });
      expect(nested.whollyChanged, `${side}: fixture must exercise a wholly changed subtree`)
        .toBeGreaterThan(0);
      expect(nested.structure, `${side}: nested element marks duplicate one subtree`).toBe(0);
      expect(nested.text, `${side}: wholly changed elements must not repeat text marks`).toBe(0);
    }

    await activateFocusGroup(beforeFrame, afterFrame, singleStyleGroup);
    for (const [filter, name] of [["文字变化", "text"], ["元素变化", "structure"]]) {
      await launched.page.getByRole("button", { name: filter, exact: true }).click();
      await expect.poll(
        async () => afterFrame.locator("html").getAttribute("data-pageroot-review-filter"),
        { timeout: 15_000 },
      ).toBe(name);
      for (const frame of [beforeFrame, afterFrame]) {
        await expect(frame.locator("html"))
          .toHaveAttribute("data-pageroot-review-focus-group", "");
        await expect(frame.locator("[data-pageroot-review-overlay-box]")).toHaveCount(0);
        await expect(frame.locator("[data-pageroot-review-mask-hole]")).toHaveCount(0);
        await expect(frame.locator("[data-pageroot-review-mask-dim]")).toHaveCount(0);
      }
      await launched.page.screenshot({
        path: path.join(captureDirectory, `review-annotation-${name}.png`),
        animations: "disabled",
      });
    }

    // Close-up evidence for the dash rhythm and the dot row. The strike and the
    // dots are only a few pixels tall, so a whole-window capture cannot show
    // whether the red rule reads as dashes or the green row sits level. Element
    // screenshots would be misplaced by the canvas scale transform, so clip the
    // page using layout coordinates and read the canvas at 100%. The shared
    // review toolbar is outside the page region and does not alter the clip.
    await launched.page.getByRole("button", { name: "全部变化" }).click();
    await expect.poll(
      async () => afterFrame.locator("html").getAttribute("data-pageroot-review-filter"),
      { timeout: 15_000 },
    ).toBe("all");
    await launched.page.getByRole("button", { name: "原始大小", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "原始大小", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect(liveReviewTools).toBeVisible();
    for (const [label, frame, selector] of [
      ["strike-paragraph", beforeFrame, ".trend-copy"],
      ["strike-note", beforeFrame, '[data-report-metric="overall"] .metric-note'],
      ["dots-paragraph", afterFrame, ".trend-copy"],
      ["dots-note", afterFrame, '[data-report-metric="overall"] .metric-note'],
    ]) {
      const target = frame.locator(selector).first();
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error(`${label}: ${selector} has no layout box.`);
      await launched.page.screenshot({
        path: path.join(captureDirectory, `review-annotation-${label}.png`),
        animations: "disabled",
        clip: {
          x: Math.max(0, box.x - 8),
          y: Math.max(0, box.y - 10),
          width: box.width + 16,
          height: box.height + 20,
        },
      });
    }
  } finally {
    await closePageRootGracefully(launched.electronApp, launched.page, { timeout: 20_000 });
    removeSourceFixture(fixture.sourceDirectory, SOURCE_PREFIX);
    removeValidatedTemporaryDirectory(launched.isolatedUserData, USER_DATA_PREFIX);
  }
});
