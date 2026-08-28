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
const ORDINARY_MODULE_BEFORE = "    <div class=\"ordinary-module\" data-review-ordinary-replacement><h2>普通标题</h2><p>北方仓储周转红线</p></div>";
const ORDINARY_MODULE_AFTER = "    <div class=\"ordinary-module\" data-review-ordinary-replacement><h2>普通标题</h2><p>海外广告买量策略</p></div>";
const JD_CARD_BEFORE = `        <div class="metric" data-report-metric="jd-retail-profit">
          <div class="metric-label">京东零售经营利润</div>
          <div class="metric-value">135<span class="metric-unit">亿元</span> <span class="up">-3.3%</span></div>
          <p class="metric-note" data-review-jd-note>零售基本盘保持韧性；利润率仍需观察。</p>
        </div>`;
const JD_CARD_AFTER = `        <div class="metric" data-report-metric="jd-retail-profit">
          <div class="metric-label">京东零售经营利润</div>
          <div class="metric-value">135<span class="metric-unit">亿元</span> <span class="up">-3.3%</span></div>
          <ul class="metric-note" data-review-jd-note><li>零售基本盘保持韧性；</li><li>利润率仍需观察。</li></ul>
        </div>`;

/** The AI candidate: text edits, one added wrapper, and ignored style edits. */
function rewriteReport(source) {
  return source
    .replace("边缘旧值", "边缘新值")
    .replace(`${ORDINARY_MODULE_BEFORE}\n`, "")
    .replace(TREND_BEFORE, TREND_AFTER)
    .replace(NOTE_BEFORE, NOTE_AFTER)
    .replace(
      `${JD_CARD_BEFORE}\n        <div class="metric" data-report-metric="overall">`,
      `        <div class="metric" data-report-metric="overall">`,
    )
    .replace(
      "        </div>\n        <div class=\"metric\" data-report-metric=\"commerce\">",
      `        </div>\n${JD_CARD_AFTER}\n        <div class="metric" data-report-metric="commerce">`,
    )
    .replace(
      '<span class="tab" data-active="true">① 大盘 &amp; 电商搜索</span>\n'
      + '      <span class="tab">② 抖音搜盘表现</span>',
      '<span class="tab">② 抖音搜盘表现</span>\n'
      + '      <span class="tab" data-active="true">① 大盘 &amp; 电商搜索</span>',
    )
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
      .map((box) => ({
        changeId: box.getAttribute("data-pageroot-review-overlay-box") || "",
        owner: box.getAttribute("data-pageroot-review-semantic-owner") || "",
        fact: box.getAttribute("data-pageroot-review-fact") || "",
        path: box.getAttribute("data-path") || "",
        tone: box.dataset.tone || "",
        types: box.dataset.types || "",
        scope: box.dataset.scope || "",
        summary: box.dataset.summary || "",
        active: box.dataset.active || "",
        label: box.querySelector("[data-pageroot-review-overlay-label]")?.textContent || "",
        labelCount: Number(box.querySelector("[data-pageroot-review-overlay-label]")
          ?.getAttribute("data-pageroot-review-label-count") || 1),
        borderWidth: Number.parseFloat(getComputedStyle(box).borderTopWidth || "0"),
        borderColor: getComputedStyle(box).borderTopColor || "",
        left: Number(box.getAttribute("data-left")),
        top: Number(box.getAttribute("data-top")),
        width: Number(box.getAttribute("data-width")),
        height: Number(box.getAttribute("data-height")),
      }));
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
      async () => afterFrame.locator("[data-pageroot-review-overlay-box]").count(),
      { timeout: 30_000 },
    ).toBeGreaterThan(0);
    await expect(launched.page.getByRole("button", { name: "原始大小", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => Promise.all([
      activeFootprintVisibleInOuterViewport(launched.page, beforeFrame, "before"),
      activeFootprintVisibleInOuterViewport(launched.page, afterFrame, "after"),
    ]).then((visible) => visible.every(Boolean)), { timeout: 30_000 }).toBe(true);

    const captureDirectory = path.join(productRoot, "output", "design-qa");
    mkdirSync(captureDirectory, { recursive: true });
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
      expect(
        projection.boxes.some((box) => box.types.includes("style")),
        `${side}: style-only changes must not enter Review facts`,
      ).toBe(false);
      expect(projection.boxes.length, `${side}: every box needs exactly one mask hole`)
        .toBe(projection.holes.length);
      projection.boxes.forEach((box, index) => {
        const hole = projection.holes[index];
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
        `${side}: reordered tabs must not be reported as element changes`,
      ).toBe(0);
    }
    for (const [side, frame] of [["before", beforeFrame], ["after", afterFrame]]) {
      const jdEvidence = await frame.locator('[data-report-metric="jd-retail-profit"]')
        .evaluate((card) => {
          const markerText = [...card.querySelectorAll("[data-pageroot-review-text]")]
            .map((marker) => marker.textContent || "").join("");
          const note = card.querySelector("[data-review-jd-note]");
          return {
            cardStructure: card.hasAttribute("data-pageroot-review-structure"),
            stableCopyMarked: ["京东零售经营利润", "135", "-3.3%"]
              .some((value) => markerText.includes(value)),
            noteStructure: note?.getAttribute("data-pageroot-review-structure") || "",
            descendantStructure: note?.querySelectorAll("[data-pageroot-review-structure]").length || 0,
            descendantText: note?.querySelectorAll("[data-pageroot-review-text]").length || 0,
          };
        });
      expect(jdEvidence.cardStructure, `${side}: the relocated JD card must stay paired`)
        .toBe(false);
      expect(jdEvidence.stableCopyMarked, `${side}: stable JD title/value must not be text evidence`)
        .toBe(false);
      expect(jdEvidence.noteStructure, `${side}: only the changed bottom wrapper is structural`)
        .toBe(side === "before" ? "removed" : "added");
      expect(jdEvidence.descendantStructure, `${side}: JD bottom subtree has duplicate structure facts`)
        .toBe(0);
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
    const edgeOwner = await afterFrame.locator("[data-review-edge-added]")
      .getAttribute("data-pageroot-review-semantic-owner");
    const edgeChangeId = await afterFrame.locator("[data-review-edge-added]")
      .getAttribute("data-pageroot-review-marker");
    const edgeBox = projections.after.boxes.find((box) => (
      box.changeId === edgeChangeId
      && box.owner === edgeOwner
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
    ).toBeCloseTo(projections.after.authoredDocumentWidth, 5);

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
    await expect.poll(async () => Promise.all(Object.values(outerViewports).map((viewport) => (
      viewport.evaluate((element) => ({
        left: element.scrollLeft,
        maximum: element.scrollWidth - element.clientWidth,
      }))
    ))).then(([before, after]) => ({
      moved: before.left > 0 && after.left > 0,
      ratioDelta: Math.abs(
        before.left / Math.max(1, before.maximum)
        - after.left / Math.max(1, after.maximum),
      ),
    })), { timeout: 15_000 }).toMatchObject({ moved: true, ratioDelta: 0 });
    writeFileSync(
      path.join(captureDirectory, "review-annotation-projection.json"),
      JSON.stringify(projections, null, 2),
      "utf8",
    );

    // 1. One change region draws one outline. A nested descendant of the same
    //    change must never earn a second box inside its container.
    for (const [side, projection] of Object.entries(projections)) {
      for (const box of projection.boxes) {
        const container = projection.boxes.find((candidate) => (
          candidate !== box
          && candidate.changeId === box.changeId
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
      // Two outlines crossing each other around one sentence read as noise even
      // when neither contains the other. Stacked line or block rectangles of one
      // owner are a legitimate exception: each has to reach below its glyphs to
      // keep the green dots inside its own footprint, so at tight leading they
      // share a hairline edge.
      const stackedRun = (left, right) => (
        left.owner === right.owner
        && ["text-line", "text-block"].includes(left.scope)
        && ["text-line", "text-block"].includes(right.scope)
      );
      for (const box of projection.boxes) {
        const crossing = projection.boxes.find((candidate) => (
          candidate !== box
          && candidate.changeId === box.changeId
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

    // 1a. Resting state is quiet. A confirmed change shows no outline color
    //     until hover or focus reaches for it — the entry state focuses the
    //     first change, so its own boxes are the one allowed claim. Captions
    //     and revision bars follow a change's contiguous stretches: a change
    //     never carries more captions than stretches, a resting caption
    //     carries a ×N multiplier exactly when it represents a genuine
    //     cluster of N nearby same-caption stretches, and every change is
    //     indexed by at least one page-edge revision bar.
    const restsTransparent = (color) => (
      color === "transparent" || /^rgba\(\d+, \d+, \d+, 0\)$/u.test(color)
    );
    for (const [side, projection] of Object.entries(projections)) {
      const captionsByChange = new Map();
      for (const box of projection.boxes) {
        if (box.active !== "true") {
          expect(
            restsTransparent(box.borderColor),
            `${side}: "${box.summary}" rests with a visible ${box.borderColor} outline`,
          ).toBe(true);
        }
        if (!box.label) continue;
        if (box.active !== "true") {
          if (box.labelCount > 1) {
            expect(
              box.label.endsWith(` ×${box.labelCount}`),
              `${side}: cluster caption "${box.label}" must end with ×${box.labelCount}`,
            ).toBe(true);
          } else {
            expect(
              box.label.includes(" ×"),
              `${side}: resting caption "${box.label}" carries a multiplier without a cluster`,
            ).toBe(false);
          }
        }
        captionsByChange.set(box.changeId, (captionsByChange.get(box.changeId) || 0) + 1);
      }
      const barsByChange = new Map();
      for (const bar of projection.bars) {
        barsByChange.set(bar.changeId, (barsByChange.get(bar.changeId) || 0) + 1);
      }
      for (const [changeId, count] of captionsByChange) {
        expect(
          count,
          `${side}: change ${changeId} carries ${count} captions for ${barsByChange.get(changeId) || 0} stretches`,
        ).toBeLessThanOrEqual(barsByChange.get(changeId) || 0);
      }
      expect(captionsByChange.size, `${side}: no caption anchors the page`)
        .toBeGreaterThan(0);
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

    // 1b. Hover previews without claiming: pointing at a resting change shows
    //     its outline, and leaving the page rests it again.
    await afterFrame.locator("html").evaluate(() => {
      const box = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")]
        .find((candidate) => (
          candidate.dataset.active !== "true"
        ));
      if (!box) throw new Error("no resting box to hover");
      const rect = box.getBoundingClientRect();
      window.dispatchEvent(new PointerEvent("pointermove", {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
    });
    await expect.poll(async () => afterFrame.locator(
      '[data-pageroot-review-overlay-box][data-hover="true"]',
    ).count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await afterFrame.locator("html").evaluate(() => {
      window.dispatchEvent(new PointerEvent("pointerout"));
    });
    await expect.poll(async () => afterFrame.locator(
      '[data-pageroot-review-overlay-box][data-hover="true"]',
    ).count(), { timeout: 10_000 }).toBe(0);

    // 1c. Focus claims the outline: clicking a page marker colors its own
    //     boxes and highlights its revision bar while every other confirmed
    //     change stays at rest.
    await afterFrame.locator("[data-pageroot-review-region-bar]").first().click();
    await expect.poll(async () => {
      const sides = {
        before: await readProjection(beforeFrame),
        after: await readProjection(afterFrame),
      };
      const activeBoxes = [...sides.before.boxes, ...sides.after.boxes]
        .filter((box) => box.active === "true");
      if (!activeBoxes.length) return "no active box";
      const claimed = activeBoxes.every((box) => !restsTransparent(box.borderColor));
      const othersRest = [...sides.before.boxes, ...sides.after.boxes]
        .filter((box) => box.active !== "true")
        .every((box) => restsTransparent(box.borderColor));
      const barClaimed = [...sides.before.bars, ...sides.after.bars]
        .some((bar) => bar.active === "true");
      if (!claimed) return "active box still transparent";
      if (!othersRest) return "a resting box is colored";
      if (!barClaimed) return "no active revision bar";
      return "ok";
    }, { timeout: 15_000 }).toBe("ok");

    // 2. The strike must read as a dashed rule. A round cap adds one stroke
    //    thickness to every dash and removes it from every gap.
    expect(projections.before.strikes.length).toBeGreaterThan(0);
    for (const strike of projections.before.strikes) {
      const [dash, gap] = strike.dashArray.split(" ").map(Number);
      expect(gap - strike.thickness, `dash pattern ${strike.dashArray} @ ${strike.thickness}px`)
        .toBeGreaterThan(1);
      expect(gap - strike.thickness).toBeGreaterThanOrEqual(dash + strike.thickness);
    }

    // 3. Green dots: exactly one per written character, centred on it, never on
    //    punctuation, and one shared baseline per rendered row.
    const dots = projections.after.dots;
    expect(dots.length).toBeGreaterThan(0);
    const positions = new Set(dots.map((dot) => `${Math.round(dot.x)}|${Math.round(dot.y)}`));
    expect(positions.size, "a character must not be dotted twice").toBe(dots.length);
    const nearestGlyph = (dot) => projections.after.glyphs
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
    const writtenGlyphs = projections.after.glyphs.filter((glyph) => (
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

    for (const [filter, name] of [["文字变化", "text"], ["元素变化", "structure"]]) {
      await launched.page.getByRole("button", { name: filter, exact: true }).click();
      await expect.poll(
        async () => afterFrame.locator("html").getAttribute("data-pageroot-review-filter"),
        { timeout: 15_000 },
      ).toBe(name);
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
