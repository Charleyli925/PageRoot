import { spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";

import { expect } from "@playwright/test";

import { sha256 } from "../../../scripts/lifecycle-core.mjs";
import {
  activateNativeEdit,
  caseSelector,
  fixtureBuffer,
  productRoot,
  setTextSelection,
} from "../browser/pageroot-driver.mjs";
import {
  closePageRootGracefully as closeSharedPageRootGracefully,
  createSourceFixture as createSharedSourceFixture,
  launchPageRoot as launchSharedPageRoot,
  loadedDiskFrame,
  openRailGlobalCommentComposer,
  removeValidatedTemporaryDirectory,
  removeSourceFixture as removeSharedSourceFixture,
  seedLegacyV3Project,
  stopPageRoot,
  waitForProjectReady,
} from "./helpers/pageroot-app-fixture.mjs";

export {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
};
export { spawnSync, tmpdir, path, inflateSync, expect, sha256 };
export {
  activateNativeEdit,
  caseSelector,
  fixtureBuffer,
  productRoot,
  setTextSelection,
};
export {
  loadedDiskFrame,
  openRailGlobalCommentComposer,
  seedLegacyV3Project,
  stopPageRoot,
  waitForProjectReady,
};

export async function launchPageRoot(options = {}) {
  return launchSharedPageRoot({
    userDataPrefix: "pageroot-native-e2e-ai-loop-",
    ...options,
  });
}

export async function closePageRootGracefully(electronApp, page) {
  return closeSharedPageRootGracefully(electronApp, page, { timeout: 20_000 });
}
export const ORIGINAL_TEXT = "列表项中的文字保持项目符号和缩进。";
export const UPDATED_TEXT = "自动闭环验收通过";
export const SECOND_UPDATED_TEXT = "自动闭环第二版通过";
export const QODER_VISUAL_OUTPUT = path.join(
  productRoot,
  "output/playwright/qoder-auto-connection-sync",
);
mkdirSync(QODER_VISUAL_OUTPUT, { recursive: true });
export const PICKER_TEXT = "项目切换原子发布验收通过";
export const READABLE_REWRITE_BEFORE = "综搜整体仍处于放缓背景，关键不在于单纯增加曝光，而在于识别商品需求，并用更匹配的供给承接；核心仍是让模型识别电商意图，再优化结果组织，把模糊兴趣转化为可验证需求。";
export const READABLE_REWRITE_AFTER = "综搜放缓，但电商搜索仍有较高大盘。关键是识别内容浏览中的潜在商品需求，并用匹配供给承接。供给可归纳为电商意图识别、优化结果组织，将模糊兴趣转为可验证需求。";
export const LINE_SCOPE_BEFORE = "甲旧，中间稳定文字保持不变，乙旧。";
export const LINE_SCOPE_AFTER = "甲新，中间稳定文字保持不变，乙新。";
export const SCOPE_PROMOTION_BEFORE = "稳定开场。甲旧，稳甲，乙旧，稳乙，丙旧。<br>丁旧，稳丁，戊旧，稳戊，己旧。<br>庚旧，稳庚，辛旧，稳辛，壬旧。<br>稳定收尾行。";
export const SCOPE_PROMOTION_AFTER = "稳定开场。甲新，稳甲，乙新，稳乙，丙新。<br>丁新，稳丁，戊新，稳戊，己新。<br>庚新，稳庚，辛新，稳辛，壬新。<br>稳定收尾行。";
// A page footer lives outside <main>; a single-file page has no site chrome, so
// a rewrite there must still be reviewed instead of silently disappearing.
export const OUTSIDE_MAIN_BEFORE = "口径说明：数据来自公开披露的季度公告（未经审计）；分类目口径与公告分部不同，跨期可比性受限。";
export const OUTSIDE_MAIN_AFTER = "口径说明：数据来自公开披露的季度公告（未经审计）；分类目口径与公告分部一致。";
export const REVIEW_METRIC_BEFORE_CSS = `
      [data-review-metrics] {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }
      [data-review-metric] {
        display: grid;
        gap: 10px;
        padding: 18px;
        border: 2px solid #d9dcec;
        border-top: 4px solid #6d5ce7;
        border-radius: 16px;
        background: #ffffff;
        color: #2d2d39;
      }
      [data-review-metric] strong { color: #6d5ce7; font-size: 28px; }
      [data-review-metric] span { color: #555767; }
      [data-review-metric] small { color: #239b56; }
      [data-review-inherited-copy] { color: #555767; font-family: sans-serif; }
      [data-review-logical-card] { block-size: 54px; inline-size: 240px; overflow: hidden; }
`;
export const REVIEW_METRIC_AFTER_CSS = `
      [data-review-metrics] {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }
      [data-review-metric] {
        display: grid;
        gap: 10px;
        padding: 18px;
        border: 2px solid #241d58;
        border-top: 4px solid #6d5ce7;
        border-radius: 16px;
        background: #241d58;
        color: #ffffff;
      }
      [data-review-metric] strong { color: #ffffff; font-size: 28px; }
      [data-review-metric] span { color: #dedcf2; }
      [data-review-metric] small { color: #9fe6bf; }
      [data-review-inherited-copy] { color: #ffffff; font-family: sans-serif; }
      [data-review-logical-card] { block-size: 84px; inline-size: 240px; overflow: hidden; }
`;

export const REVIEW_MASK_UNION_BEFORE = `
      <style data-review-hostile-mask-css>
        svg path, mask rect, path, rect {
          fill: #00ff00 !important;
          fill-opacity: .05 !important;
          stroke: #00ffff !important;
          opacity: .05 !important;
          filter: blur(4px) !important;
          transform: translate(71px, 19px) !important;
        }
        [id^="pageroot-review-mask"] {
          display: none !important;
          opacity: .01 !important;
          filter: blur(4px) !important;
          transform: translate(71px, 19px) !important;
        }
      </style>
      <section data-review-mask-union-fixture>
        <h2>遮罩并集</h2>
        <div data-review-mask-stage style="position:relative;display:flow-root;width:300px;height:170px;margin:20px 0;background:rgb(204, 0, 0)">
          <div id="review-mask-fact-alpha" data-review-mask-fact="alpha" style="display:block;margin:24px 0 0 24px;width:150px;height:86px;border:2px solid #4a1111;color:transparent">A</div>
          <div id="review-mask-fact-beta" data-review-mask-fact="beta" style="display:block;margin:-52px 0 0 96px;width:150px;height:86px;border:2px solid #114a11;color:transparent">B</div>
          <svg aria-hidden="true" width="1" height="1"><mask id="pageroot-review-mask-forged"><rect width="1" height="1"></rect></mask></svg>
        </div>
      </section>`;

export const REVIEW_MASK_UNION_AFTER = `
      <style data-review-hostile-mask-css>
        svg path, mask rect, path, rect {
          fill: #00ff00 !important;
          fill-opacity: .05 !important;
          stroke: #00ffff !important;
          opacity: .05 !important;
          filter: blur(4px) !important;
          transform: translate(71px, 19px) !important;
        }
        [id^="pageroot-review-mask"] {
          display: none !important;
          opacity: .01 !important;
          filter: blur(4px) !important;
          transform: translate(71px, 19px) !important;
        }
      </style>
      <section data-review-mask-union-fixture>
        <h2>遮罩并集</h2>
        <div data-review-mask-stage style="position:relative;display:flow-root;width:300px;height:170px;margin:20px 0;background:rgb(204, 0, 0)">
          <div id="review-mask-fact-alpha" data-review-mask-fact="alpha" style="display:block;margin:24px 0 0 24px;width:150px;height:86px;border:6px solid #6d5ce7;color:transparent">A</div>
          <div id="review-mask-fact-beta" data-review-mask-fact="beta" style="display:block;margin:-52px 0 0 96px;width:150px;height:86px;border:6px solid #d26a81;color:transparent">B</div>
          <svg aria-hidden="true" width="1" height="1"><mask id="pageroot-review-mask-forged"><rect width="1" height="1"></rect></mask></svg>
        </div>
      </section>`;

export function decodePngPixels(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Expected a PNG screenshot.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error("Unsupported screenshot PNG format.");
  }
  const bytesPerRow = width * channels;
  const source = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(bytesPerRow * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = source[sourceOffset];
    sourceOffset += 1;
    const rowOffset = row * bytesPerRow;
    for (let column = 0; column < bytesPerRow; column += 1) {
      const raw = source[sourceOffset + column];
      const left = column >= channels ? pixels[rowOffset + column - channels] : 0;
      const up = row > 0 ? pixels[rowOffset - bytesPerRow + column] : 0;
      const upLeft = row > 0 && column >= channels
        ? pixels[rowOffset - bytesPerRow + column - channels]
        : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 0xff;
      if (filter === 2) value = (raw + up) & 0xff;
      if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 0xff;
      if (filter === 4) {
        const predictor = left + up - upLeft;
        const leftDistance = Math.abs(predictor - left);
        const upDistance = Math.abs(predictor - up);
        const upLeftDistance = Math.abs(predictor - upLeft);
        const paeth = leftDistance <= upDistance && leftDistance <= upLeftDistance
          ? left
          : upDistance <= upLeftDistance ? up : upLeft;
        value = (raw + paeth) & 0xff;
      }
      if (filter > 4) throw new Error("Unsupported screenshot PNG filter.");
      pixels[rowOffset + column] = value;
    }
    sourceOffset += bytesPerRow;
  }
  return {
    width,
    height,
    pixelAt(x, y) {
      const column = Math.max(0, Math.min(width - 1, Math.floor(x)));
      const row = Math.max(0, Math.min(height - 1, Math.floor(y)));
      const offset = (row * width + column) * channels;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    },
  };
}

export function createSourceFixture(
  fileName = "generated-ai-loop.html",
  transform = (source) => source,
) {
  return createSharedSourceFixture({
    fileName,
    transform,
    sourceDirectoryPrefix: "pageroot-ai-loop-source-",
  });
}

export function removeSourceFixture(sourceDirectory) {
  removeSharedSourceFixture(sourceDirectory, "pageroot-ai-loop-source-");
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function createQoderAcpE2ECommand(directory, {
  hang = false,
  pidFile = null,
  authRequired = false,
  capacityUnavailable = false,
} = {}) {
  const command = path.join(directory, "pageroot-qoder-acp-e2e");
  const agent = path.join(productRoot, "tests", "fixtures", "qoder-acp-agent.mjs");
  const fixtureArgs = [
    hang ? "--hang" : null,
    pidFile ? `--pid-file=${pidFile}` : null,
    authRequired ? "--auth-required" : null,
    capacityUnavailable ? "--capacity-unavailable" : null,
  ].filter(Boolean).map(shellQuote).join(" ");
  writeFileSync(
    command,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(agent)}${
      fixtureArgs ? ` ${fixtureArgs}` : ""
    } "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  chmodSync(command, 0o755);
  return command;
}

// The destination is chosen in the AI conversation now; the dialog over the page is gone.
// A specific change is reached by stepping the change navigator: the content map that
// used to list them is gone. Bounded, so a change that never focuses fails the test
// instead of looping forever.
// Qoder availability moved out of the delivery dialog and into 关于源页; that card is
// where installation, login and readiness are surfaced now.
export async function openQoderAvailability(page) {
  await page.getByRole("button", { name: "关于源页" }).click();
  const card = page.getByRole("dialog").locator(".about-agent-section");
  await expect(card).toBeVisible();
  return card;
}

export async function closeQoderAvailability(page) {
  await page.getByRole("button", { name: "关闭关于源页" }).click();
}

export async function focusChangeById(page, frame, changeId) {
  const next = page.getByRole("button", { name: "下一处变化" });
  for (let step = 0; step < 40; step += 1) {
    const focused = await frame.locator("html")
      .getAttribute("data-pageroot-review-focus");
    if (focused === changeId) return;
    await next.click();
    await page.waitForTimeout(120);
  }
  throw new Error(`Change ${changeId} never became focused.`);
}

export async function chooseModifyIntent(page) {
  const sidebar = page.getByTestId("ai-conversation-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByTestId("ai-conversation-intent")).toHaveCount(0);
  await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
  return sidebar;
}

export async function chooseClipboardDelivery(page) {
  const sidebar = await chooseModifyIntent(page);
  await sidebar.getByRole("button", { name: /复制给别的 AI/u }).click();
}


export function removeAiLoopUserData(isolatedUserData) {
  removeValidatedTemporaryDirectory(
    isolatedUserData,
    "pageroot-native-e2e-ai-loop-",
  );
}

export async function addCommentAndSubmit(
  page,
  electronApp,
  sourcePath,
  updatedText = UPDATED_TEXT,
  additionalComments = [],
) {
  await electronApp.evaluate(({ clipboard }) => clipboard.clear());
  let activeSourcePath = await addComment(
    page,
    sourcePath,
    `只把这个列表项改为“${updatedText}”，其他地方保持不变。`,
  );
  for (const comment of additionalComments) {
    activeSourcePath = await addComment(
      page,
      activeSourcePath,
      comment.text,
      comment.targetCase,
      comment.targetSelector,
    );
  }
  await page.getByRole("button", { name: /AI 助手/u }).click();
  await chooseClipboardDelivery(page);
  await expect(page.getByTestId("ai-conversation-action-bar")
    .getByText("任务已复制，等你的 AI 改完", { exact: true }))
    .toBeVisible();
  await expect(page.getByTestId("ai-conversation-run-progress"))
    .toContainText("等待 AI 完成");
  let promptPath = "";
  await expect.poll(async () => {
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    const match = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u);
    promptPath = match?.[1] || "";
    return Boolean(promptPath && existsSync(promptPath));
  }, { timeout: 20_000 }).toBe(true);
  // The round is carried by the conversation now, not by a header button opening a panel.
  await expect(page.getByTestId("ai-conversation-run-progress")).toBeVisible();
  const requestRoot = path.dirname(promptPath);
  const changeRequest = JSON.parse(
    readFileSync(path.join(requestRoot, "change-request.json"), "utf8"),
  );
  expect(changeRequest.requirements.instructions).toHaveLength(
    1 + additionalComments.length,
  );
  expect(changeRequest.requirements.instructions.some(
    (instruction) => instruction.text.includes(updatedText),
  )).toBe(true);
  expect(changeRequest.requirements.preserveOutsideTargets).toBe(true);
  return { promptPath, requestRoot, changeRequest, sourcePath: activeSourcePath };
}

export async function addComment(page, sourcePath, text = (
  `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`
), targetCase = "list-item", targetSelector = "") {
  // Opening an external HTML immediately switches the active document to its
  // managed V1 Working Copy. Comments must target that authoritative file,
  // while the original source remains untouched.
  const active = await page.evaluate(
    () => window.htmlAIProjects?.getActiveProject(),
  );
  const frame = await loadedDiskFrame(page, active?.sourcePath || sourcePath);
  const target = frame.locator(targetSelector || caseSelector(targetCase));
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
  await composer.fill(text);
  await page.getByRole("button", { name: "评论", exact: true }).click();
  // Saving the first comment may need the Bridge's bounded project/draft
  // authority recovery (two 15 s read attempts). Wait for the actual save
  // boundary and the resulting geometry authority instead of racing the
  // default 20 s assertion timeout against that recovery path.
  await expect(composer).toBeHidden({ timeout: 45_000 });
  await expect(page.getByRole("complementary", { name: "本轮评论" }))
    .toHaveAttribute("data-layout-ready", "true", { timeout: 45_000 });
  await expect(page.locator(".comment-card").filter({ hasText: text }))
    .toHaveCount(1);
  return (await page.evaluate(
    () => window.htmlAIProjects?.getActiveProject(),
  ))?.sourcePath || sourcePath;
}

export async function openRecentProject(page, sourcePath, options) {
  const visibleToast = page.locator(".toast.show");
  await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await visibleToast.isVisible()) {
    await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
    await expect(visibleToast).toBeHidden();
  }
  const activeBefore = await page.evaluate(
    async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
  );
  await page.getByRole("button", { name: "打开新的本地 HTML" }).click();
  await page.locator(".recent-file-row")
    .filter({ hasText: path.basename(sourcePath) })
    .click();
  await waitForProjectReady(page);
  await expect.poll(async () => {
    const active = await page.evaluate(
      async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
    );
    return active && active !== activeBefore ? active : "";
  }, { timeout: 30_000 }).not.toBe("");
  const activeSourcePath = await page.evaluate(
    async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
  );
  return loadedDiskFrame(page, activeSourcePath, options);
}

export function managedProjectRoots(workspace) {
  const projectsRoot = path.join(path.dirname(workspace), "project-files");
  if (!existsSync(projectsRoot)) return [];
  return readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(projectsRoot, entry.name))
    .filter((projectRoot) => existsSync(path.join(projectRoot, ".pageroot", "project.json")));
}

export function managedProjectRootForId(workspace, projectId) {
  return managedProjectRoots(workspace).find((projectRoot) => {
    const project = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "project.json"),
      "utf8",
    ));
    return project.projectId === projectId;
  }) || null;
}

export function requestDirectoryCount(workspace) {
  const projectsRoot = path.join(workspace, "projects");
  const legacyCount = !existsSync(projectsRoot) ? 0 : readdirSync(projectsRoot).reduce((total, projectDirectoryName) => {
    const requestsRoot = path.join(
      projectsRoot,
      projectDirectoryName,
      "requests",
    );
    return total + (
      existsSync(requestsRoot)
        ? readdirSync(requestsRoot).filter((entry) => !entry.startsWith(".")).length
        : 0
    );
  }, 0);
  return legacyCount + managedProjectRoots(workspace).reduce((total, projectRoot) => {
    const requestsRoot = path.join(projectRoot, ".pageroot", "requests");
    return total + (
      existsSync(requestsRoot)
        ? readdirSync(requestsRoot).filter((name) => !name.startsWith(".")).length
        : 0
    );
  }, 0);
}

export function workspaceContainsDraftComment(workspace, text) {
  const projectsRoot = path.join(workspace, "projects");
  const legacyContains = existsSync(projectsRoot) && readdirSync(projectsRoot).some((projectDirectoryName) => {
    const draftPath = path.join(
      projectsRoot,
      projectDirectoryName,
      "draft",
      "annotations.json",
    );
    if (!existsSync(draftPath)) return false;
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    return Array.isArray(draft.comments)
      && draft.comments.some((comment) => comment.text === text);
  });
  if (legacyContains) return true;
  return managedProjectRoots(workspace).some((projectRoot) => {
    const draftsRoot = path.join(projectRoot, ".pageroot", "drafts");
    return existsSync(draftsRoot) && readdirSync(draftsRoot)
      .filter((name) => name.endsWith(".json"))
      .some((name) => {
        const draft = JSON.parse(readFileSync(path.join(draftsRoot, name), "utf8"));
        return Array.isArray(draft.comments)
          && draft.comments.some((comment) => comment.text === text);
      });
  });
}

export function rewriteWorkspaceDraftComment(workspace, text, update) {
  const projectsRoot = path.join(workspace, "projects");
  const draftPaths = existsSync(projectsRoot)
    ? readdirSync(projectsRoot).map((projectDirectoryName) => path.join(
      projectsRoot,
      projectDirectoryName,
      "draft",
      "annotations.json",
    ))
    : [];
  for (const projectRoot of managedProjectRoots(workspace)) {
    const draftsRoot = path.join(projectRoot, ".pageroot", "drafts");
    if (!existsSync(draftsRoot)) continue;
    for (const name of readdirSync(draftsRoot)) {
      if (name.endsWith(".json")) draftPaths.push(path.join(draftsRoot, name));
    }
  }
  for (const draftPath of draftPaths) {
    if (!existsSync(draftPath)) continue;
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    const comment = Array.isArray(draft.comments)
      ? draft.comments.find((candidate) => candidate.text === text)
      : null;
    if (!comment) continue;
    update(comment);
    draft.draftRevision = Math.max(0, Number(draft.draftRevision) || 0) + 1;
    draft.updatedAt = new Date().toISOString();
    const draftBytes = Buffer.from(`${JSON.stringify(draft, null, 2)}\n`, "utf8");
    const managedProjectRoot = managedProjectRoots(workspace).find((projectRoot) => (
      draftPath.startsWith(`${path.join(projectRoot, ".pageroot", "drafts")}${path.sep}`)
    ));
    if (managedProjectRoot) {
      const controlRoot = path.join(managedProjectRoot, ".pageroot");
      const manifest = JSON.parse(readFileSync(path.join(controlRoot, "manifest.json"), "utf8"));
      const workingCopy = manifest.workingCopies.find(
        (entry) => entry.workingCopyId === draft.workingCopyId,
      );
      if (!workingCopy?.stateRelativePath) return false;
      const statePath = path.join(
        controlRoot,
        ...String(workingCopy.stateRelativePath).split("/"),
      );
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      state.draftRevision = draft.draftRevision;
      state.draftSha256 = sha256(draftBytes);
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    }
    writeFileSync(draftPath, draftBytes);
    return true;
  }
  return false;
}

export function frozenAiOutputPath(requestRoot, changeRequest) {
  const legacyRelativePath = changeRequest.finalization?.outputRelativePath;
  if (typeof legacyRelativePath === "string" && legacyRelativePath.startsWith("output/")) {
    return path.join(
      requestRoot,
      "attempts",
      "attempt_001",
      ...legacyRelativePath.split("/"),
    );
  }
  const requestRecord = JSON.parse(readFileSync(
    path.join(requestRoot, "request.json"),
    "utf8",
  ));
  const outputRelativePath = requestRecord.outputRelativePath;
  const expectedPrefix = `requests/${changeRequest.requestId}/attempts/${changeRequest.attemptId}/output/`;
  if (
    typeof outputRelativePath !== "string"
    || !outputRelativePath.startsWith(expectedPrefix)
  ) {
    throw new Error("Request is missing its frozen AI output path.");
  }
  const controlRoot = path.dirname(path.dirname(requestRoot));
  const outputPath = path.resolve(controlRoot, ...outputRelativePath.split("/"));
  if (!outputPath.startsWith(`${controlRoot}${path.sep}`)) {
    throw new Error("Request output escaped its managed control directory.");
  }
  return outputPath;
}

export function writeAiOutput(requestRoot, transform) {
  const base = readFileSync(
    path.join(requestRoot, "input", "base", "index.html"),
    "utf8",
  );
  const output = transform(base);
  const changeRequest = JSON.parse(readFileSync(
    path.join(requestRoot, "change-request.json"),
    "utf8",
  ));
  const outputPath = frozenAiOutputPath(requestRoot, changeRequest);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, "utf8");
}

export function runOfficialFinalizer(requestRoot, changeRequest) {
  const command = changeRequest.finalization?.finalizerCommand
    || readFileSync(path.join(requestRoot, "PROMPT.md"), "utf8")
      .match(/```sh\s*\r?\n([^\r\n]+)\r?\n```/u)?.[1];
  if (!command) throw new Error("Request is missing its frozen finalizer command.");
  const result = spawnSync("/bin/zsh", ["-lc", command], {
    cwd: requestRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`Finalizer failed:\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

export function workingHtmlFiles(workspace, projectId) {
  const legacyRegistryPath = path.join(workspace, "project-registry.json");
  if (existsSync(legacyRegistryPath)) {
    const registry = JSON.parse(readFileSync(legacyRegistryPath, "utf8"));
    const storageDirectoryName = registry.projects?.[projectId]?.storageDirectoryName;
    if (storageDirectoryName) {
      const directory = path.join(workspace, "projects", storageDirectoryName, "working");
      if (!existsSync(directory)) return [];
      return readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".html"))
        .map((fileName) => path.join(directory, fileName));
    }
  }

  const projectRoot = managedProjectRootForId(workspace, projectId);
  if (!projectRoot) return [];
  const manifest = JSON.parse(readFileSync(
    path.join(projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  return (Array.isArray(manifest.workingCopies) ? manifest.workingCopies : [])
    .map((workingCopy) => String(workingCopy.sourceRelativePath || ""))
    .filter((relativePath) => relativePath.endsWith(".html"))
    .map((relativePath) => path.join(projectRoot, relativePath))
    .filter((filePath) => existsSync(filePath));
}

export function candidateHtmlFiles(workspace, projectId) {
  const projectRoot = managedProjectRootForId(workspace, projectId);
  if (!projectRoot) return [];
  const requestsRoot = path.join(projectRoot, ".pageroot", "requests");
  if (!existsSync(requestsRoot)) return [];
  return readdirSync(requestsRoot)
    .filter((requestId) => !requestId.startsWith("."))
    .map((requestId) => path.join(requestsRoot, requestId, "candidate.html"))
    .filter((filePath) => existsSync(filePath));
}

export async function adoptReadyResult(page) {
  await page.getByRole("button", { name: /直接采用|采纳这一版/u }).click();
}

export const REVIEW_PROJECTION_CASES = Object.freeze([
  {
    id: "added-table-row",
    sourceFixture: "generated-ai-loop.html",
    filter: "all",
    pageMode: "split",
    contextPercent: "18",
    changeType: "structure",
    ownerSelector: '[data-review-brand-row="added"]',
    rangeSelector: null,
    expectedFrameCount: 1,
    expectedMaskCount: 1,
    tolerance: 0.75,
    negativeSelectors: [
      '[data-review-brand-row="alpha"] [data-pageroot-review-overlay-box]',
      '[data-review-brand-row="beta"] [data-pageroot-review-overlay-box]',
    ],
  },
]);

export async function assertReviewControlDefaults(page, beforeReviewFrame) {
  await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
    "data-pageroot-review-filter",
  ), { timeout: 30_000 }).toBe("all");
  await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
    "data-pageroot-review-focus",
  )).not.toBe("all");
  await expect(page.getByRole("slider", {
    name: "非修改区域上下文可见度",
  })).toHaveValue("18");
  await expect(page.locator('[data-view="split"]')).toBeVisible();
  await expect(page.getByRole("button", {
    name: "双页对比（修改前与 AI 修改后）",
  })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "查看全部变化" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "适应", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
}

export async function assertReviewChangeOutline(beforeReviewFrame, afterReviewFrame) {
  await expect.poll(async () => Promise.all(
    [beforeReviewFrame, afterReviewFrame].map(async (frame) => (
      (await frame.locator("[data-pageroot-review-overlay-box]").count()) > 0
    )),
  ).then((states) => states.every(Boolean))).toBe(true);
}

export async function assertProjectionGeometryCase(frame, geometryCase) {
  const owner = await frame.locator(geometryCase.ownerSelector)
    .getAttribute("data-pageroot-review-semantic-owner");
  expect(owner, `${geometryCase.id} must retain a semantic owner`).toBeTruthy();
  const frames = frame.locator(
    `[data-pageroot-review-overlay-box][data-tone="${geometryCase.changeType}"][data-pageroot-review-semantic-owner="${owner}"]`,
  );
  const masks = frame.locator(
    `[data-pageroot-review-mask-hole][data-pageroot-review-semantic-owner="${owner}"]`,
  );
  await expect(frames).toHaveCount(geometryCase.expectedFrameCount);
  await expect(masks).toHaveCount(geometryCase.expectedMaskCount);
  await expect.poll(() => frames.evaluate((overlay, { ownerSelector, tolerance }) => {
    const owner = document.querySelector(ownerSelector);
    if (!owner) return false;
    const overlayRect = overlay.getBoundingClientRect();
    const ownerRect = owner.getBoundingClientRect();
    return Math.abs(overlayRect.left - (ownerRect.left - 3)) < tolerance
      && Math.abs(overlayRect.top - (ownerRect.top - 3)) < tolerance
      && Math.abs(overlayRect.width - (ownerRect.width + 6)) < tolerance
      && Math.abs(overlayRect.height - (ownerRect.height + 6)) < tolerance;
  }, geometryCase)).toBe(true);
  for (const selector of geometryCase.negativeSelectors) {
    await expect(frame.locator(selector)).toHaveCount(0);
  }
  return owner;
}

export async function assertOverlayMaskEquivalence(frame) {
  return frame.locator("html").evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")];
    const holes = [...document.querySelectorAll("[data-pageroot-review-mask-hole]")];
    return boxes.length === holes.length && boxes.every((box, index) => {
      const hole = holes[index];
      return Math.abs(Number(box.getAttribute("data-left")) - Number(hole.getAttribute("data-left"))) < .02
        && Math.abs(Number(box.getAttribute("data-top")) - Number(hole.getAttribute("data-top"))) < .02
        && Math.abs(Number(box.getAttribute("data-width")) - Number(hole.getAttribute("data-width"))) < .02
        && Math.abs(Number(box.getAttribute("data-height")) - Number(hole.getAttribute("data-height"))) < .02
        && Boolean(box.getAttribute("data-path"))
        && box.getAttribute("data-path") === hole.getAttribute("d");
    });
  });
}

export async function assertRuntimeVisualSupplement(page, beforeReviewFrame, afterReviewFrame) {
  const runtimeSnapshotSection = "section[data-review-runtime-snapshot]";
  const reviewWorkspace = page.getByTestId("ai-review-workspace");
  await expect(reviewWorkspace).toHaveAttribute(
    "data-review-runtime-visual-state",
    "resolved",
    { timeout: 20_000 },
  );
  await expect(reviewWorkspace).toHaveAttribute(
    "data-review-runtime-visual-delivery",
    "complete",
    { timeout: 20_000 },
  );
  const resolvedMarkerCount = Number(await reviewWorkspace.getAttribute(
    "data-review-runtime-visual-marker-count",
  ));
  expect(Number.isSafeInteger(resolvedMarkerCount)).toBe(true);
  expect(resolvedMarkerCount).toBeGreaterThanOrEqual(0);
  expect(resolvedMarkerCount).toBeLessThanOrEqual(32);
  const staticBoxFactsBySide = await Promise.all(
    [beforeReviewFrame, afterReviewFrame].map((frame) => (
      frame.locator("#review-runtime-static-box-canvas").evaluate((element) => JSON.parse(
        element.getAttribute("data-pageroot-review-projection-facts") || "[]",
      ))
    )),
  );
  const staticBoxFactBySide = staticBoxFactsBySide.map((facts) => facts.find((fact) => (
    fact.type === "style" && fact.scope === "box" && fact.operation !== "layout"
  )));
  expect(staticBoxFactBySide.every(Boolean)).toBe(true);
  expect(staticBoxFactBySide[0].geometryOwnerId).toBeTruthy();
  expect(staticBoxFactBySide[1].geometryOwnerId)
    .toBe(staticBoxFactBySide[0].geometryOwnerId);
  const runtimeBoxCounts = [];
  const localRuntimeFactIdsBySide = [];
  for (const frame of [beforeReviewFrame, afterReviewFrame]) {
    const runtimeBoxes = frame.locator(
      '[data-pageroot-review-overlay-box][data-pageroot-review-fact^="style:runtime-projection-"]',
    );
    // A cold offscreen owner may legitimately resolve with zero markers under
    // its fail-closed deadline. Non-empty results can also include other visual
    // candidates in this broad fixture, some of which are suppressed by an
    // exact same-host static box fact.
    const minimumRuntimeBoxes = resolvedMarkerCount > 0 ? 1 : 0;
    const maximumRuntimeBoxes = resolvedMarkerCount;
    await expect.poll(async () => {
      const count = await runtimeBoxes.count();
      return count >= minimumRuntimeBoxes && count <= maximumRuntimeBoxes;
    }).toBe(true);
    runtimeBoxCounts.push(await runtimeBoxes.count());
    await expect(frame.locator(runtimeSnapshotSection))
      .not.toHaveAttribute("data-pageroot-review-runtime-marker", "true");
    await expect(frame.locator(
      "[data-pageroot-review-runtime-marker], [data-pageroot-review-runtime-host], [data-pageroot-review-runtime-source-box]",
    )).toHaveCount(0);
    await expect.poll(() => runtimeBoxes.evaluateAll((overlays) => {
      const localTargets = [
        document.querySelector("#review-runtime-snapshot-canvas"),
        document.querySelector("#review-runtime-snapshot-host"),
      ].filter(Boolean);
      const suppressedTarget = document.querySelector("#review-runtime-static-box-canvas");
      if (localTargets.length !== 2 || !suppressedTarget) {
        return { valid: false, reason: "fixture-target-missing" };
      }
      const overlayRects = overlays.map((overlay) => ({
        left: Number(overlay.getAttribute("data-left")),
        top: Number(overlay.getAttribute("data-top")),
        width: Number(overlay.getAttribute("data-width")),
        height: Number(overlay.getAttribute("data-height")),
      }));
      const candidateTargets = [...document.querySelectorAll(
        "canvas, svg, #review-runtime-snapshot-host",
      )].filter((target) => (
        target !== suppressedTarget
        && !target.closest("[data-pageroot-review-projection-layer]")
      ));
      const candidateTargetRects = candidateTargets.map((target) => {
        const rect = target.getBoundingClientRect();
        return {
          left: rect.left + scrollX - 3,
          top: rect.top + scrollY - 3,
          width: rect.width + 6,
          height: rect.height + 6,
        };
      });
      const suppressedRect = suppressedTarget.getBoundingClientRect();
      const suppressedTargetRect = {
        left: suppressedRect.left + scrollX - 3,
        top: suppressedRect.top + scrollY - 3,
        width: suppressedRect.width + 6,
        height: suppressedRect.height + 6,
      };
      const matches = (overlay, target) => (
        Math.abs(overlay.left - target.left) < .3
          && Math.abs(overlay.top - target.top) < .3
          && Math.abs(overlay.width - target.width) < .3
          && Math.abs(overlay.height - target.height) < .3
      );
      const usedCandidateTargets = new Set();
      const matchedCandidateTargets = overlayRects.map((overlay) => {
        const targetIndex = candidateTargetRects.findIndex((target, index) => (
          !usedCandidateTargets.has(index) && matches(overlay, target)
        ));
        if (targetIndex >= 0) usedCandidateTargets.add(targetIndex);
        return targetIndex;
      });
      const valid = matchedCandidateTargets.every((index) => index >= 0)
        && overlayRects.every((overlay) => !matches(overlay, suppressedTargetRect));
      return valid ? "valid" : JSON.stringify({
        overlayRects,
        candidateTargetRects,
        suppressedTargetRect,
        matchedCandidateTargets,
      });
    })).toBe("valid");
    localRuntimeFactIdsBySide.push(await runtimeBoxes.evaluateAll((overlays) => {
      const localTargets = [
        document.querySelector("#review-runtime-snapshot-canvas"),
        document.querySelector("#review-runtime-snapshot-host"),
      ].filter(Boolean);
      const targetRects = localTargets.map((target) => {
        const rect = target.getBoundingClientRect();
        return {
          left: rect.left + scrollX - 3,
          top: rect.top + scrollY - 3,
          width: rect.width + 6,
          height: rect.height + 6,
        };
      });
      return overlays.flatMap((overlay) => {
        const overlayRect = {
          left: Number(overlay.getAttribute("data-left")),
          top: Number(overlay.getAttribute("data-top")),
          width: Number(overlay.getAttribute("data-width")),
          height: Number(overlay.getAttribute("data-height")),
        };
        const matchesLocalTarget = targetRects.some((target) => (
          Math.abs(overlayRect.left - target.left) < .3
          && Math.abs(overlayRect.top - target.top) < .3
          && Math.abs(overlayRect.width - target.width) < .3
          && Math.abs(overlayRect.height - target.height) < .3
        ));
        const factId = overlay.getAttribute("data-pageroot-review-fact");
        return matchesLocalTarget && factId ? [factId] : [];
      });
    }));
    const authoredAttributes = await frame.locator("html").evaluate(() => (
      [...document.querySelectorAll("*")].flatMap((element) => (
        [...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)
      )).join("\n")
    ));
    expect(authoredAttributes).not.toContain("runtime-host-");
  }
  return { localRuntimeFactIdsBySide, runtimeBoxCounts };
}

export async function assertReviewAcceptPersistence({
  page,
  sourcePath,
  original,
  expectedText,
  versionPathPattern,
}) {
  await expect.poll(async () => page.evaluate(async () => {
    const project = await window.htmlAIProjects?.getActiveProject();
    const reviewVisible = Boolean(document.querySelector('[data-testid="ai-review-workspace"]'));
    return { sourcePath: project?.sourcePath || "", reviewVisible };
  }), { timeout: 30_000 }).toMatchObject({
    sourcePath: expect.stringMatching(versionPathPattern),
    reviewVisible: false,
  });
  const opened = await page.evaluate(() => window.htmlAIProjects?.getActiveProject());
  expect(opened.sourcePath).not.toBe(sourcePath);
  expect(opened.sourcePath).toMatch(versionPathPattern);
  expect(readFileSync(sourcePath).equals(original)).toBe(true);
  expect(readFileSync(opened.sourcePath, "utf8")).toContain(expectedText);
  return opened;
}

