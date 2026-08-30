import { expect, test } from "@playwright/test";
import {
  ORIGINAL_TEXT,
  UPDATED_TEXT,
  addCommentAndSubmit,
  closePageRootGracefully,
  createSourceFixture,
  existsSync,
  launchPageRoot,
  path,
  readFileSync,
  removeSourceFixture,
  runOfficialFinalizer,
  stopPageRoot,
  workingHtmlFiles,
  writeAiOutput,
} from "./ai-closed-loop-helpers.mjs";

test("a pre-load review navigation falls back without trusting the replacement page", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("review-navigation-fallback.html", (source) => source.replace(
    "  </main>",
    `    <section data-review-navigation-fallback>
      <h2>运行态导航安全回归</h2>
      <div id="review-navigation-chart"></div>
      <script>
        const reviewNavigationVariant = "before";
        document.querySelector("#review-navigation-chart").textContent = reviewNavigationVariant;
        const reviewReplacementHtml = '<!doctype html>'
          + '<html data-review-navigation-replacement="true"><body></body></html>';
        if (document.documentElement.dataset.pagerootReviewSide) {
          location.replace(
            "data:text/html;charset=utf-8," + encodeURIComponent(reviewReplacementHtml),
          );
        }
      </script>
    </section>
  </main>`,
  ));
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base
      .replace(ORIGINAL_TEXT, UPDATED_TEXT)
      .replace(
        'const reviewNavigationVariant = "before";',
        'const reviewNavigationVariant = "after";',
      ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const beforeReviewFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterReviewFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator("html")).toHaveAttribute(
        "data-pageroot-preview-navigation-fallback",
        "true",
        { timeout: 30_000 },
      );
      await expect(frame.locator("html"))
        .not.toHaveAttribute("data-review-navigation-replacement", "true");
      await expect(frame.locator("html"))
        .toHaveAttribute("data-pageroot-review-filter", "all");
    }
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-marker-types~="text"]',
    ).filter({ hasText: UPDATED_TEXT }).first()).toBeVisible();
    await expect(afterReviewFrame.locator(
      'html[data-pageroot-review-marker-types~="structure"]',
    )).toHaveAttribute("data-pageroot-review-summary", "Script 源码调整");
    await expect(launched.page.getByText(
      "审阅画布未能安全载入，可返回 AI 修改前后重试。",
      { exact: true },
    )).toHaveCount(0);
    await expect(launched.page.locator("header.workbench-header")
      .getByLabel("审阅工具", { exact: true })).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "收起审阅工具" }))
      .toHaveCount(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a no-change result returns to editing and remains reopenable", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("no-change-recovery.html");
  let launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base);
    runOfficialFinalizer(request.requestRoot, request.changeRequest);

    const noChangeBar = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(noChangeBar.getByText("这次没有产生有效变化", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(noChangeBar.getByText(
      "原评论和附件都已保留，调整要求后可以重新发送。",
      { exact: true },
    )).toBeVisible();
    // The round is over with nothing to adopt: ending it from the bar returns
    // the page to editing.
    await expect(noChangeBar.getByRole("button", { name: "结束本轮" }))
      .toBeVisible();
    await expect(launched.page.getByRole("button", { name: "修改要求" }))
      .toHaveCount(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    await closePageRootGracefully(launched.electronApp, launched.page);
    launched = await launchPageRoot({
      activeSourcePath: request.sourcePath,
      isolatedUserData: launched.isolatedUserData,
    });
    await expect(launched.page.getByRole("button", { name: "上轮处理" }))
      .toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByRole("button", { name: /AI 助手/u }))
      .toBeEnabled();
    // The settled round is not the active run after restart. The header's
    // recent-outcome control restores it and opens its one presentation owner:
    // the conversation. A second AI-assistant click must not be required.
    await launched.page.getByRole("button", { name: "上轮处理" }).click();
    const reopenedBar = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(reopenedBar.getByText("这次没有产生有效变化", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    const aiTask = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects?.revealAiTask({ sourcePath })
    ), request.sourcePath);
    expect(aiTask?.aiTaskPath).toMatch(/\/AI任务\//u);
    expect(readFileSync(path.join(aiTask.aiTaskPath, "PROMPT.md"), "utf8"))
      .toContain("只把这个列表项改为");
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("output without the mandatory finalizer never creates or opens a version", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    await launched.page.waitForTimeout(3_500);
    await expect(launched.page.getByTestId("ai-conversation-action-bar")
    .getByText("任务已复制，等你的 AI 改完", { exact: true }))
      .toBeVisible();
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a malformed AI HTML return is rejected before completion or opening", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      request.requestRoot,
      () => `<html><body><p>${UPDATED_TEXT}</p>`,
    );
    expect(() => runOfficialFinalizer(request.requestRoot, request.changeRequest))
      .toThrow(/INVALID_HTML_DOCUMENT|complete HTML document/u);
    const attemptRoot = path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
    );
    expect(existsSync(path.join(attemptRoot, "completion.json"))).toBe(false);
    await launched.page.waitForTimeout(3_500);
    await expect(launched.page.getByTestId("ai-conversation-action-bar")
    .getByText("任务已复制，等你的 AI 改完", { exact: true }))
      .toBeVisible();
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an AI return cannot drop a retained source identity", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("candidate-identity-loss.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(
      /\sdata-pageroot-id="pr1_[a-f0-9]{32}"/u,
      "",
    ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);

    const actionBar = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(actionBar).toContainText(
      "输出未保留现有源码元素身份，或包含重复、伪造的 Stable ID",
      { timeout: 30_000 },
    );
    const requestRecord = JSON.parse(readFileSync(
      path.join(request.requestRoot, "request.json"),
      "utf8",
    ));
    expect(requestRecord.status).toBe("error");
    expect(requestRecord.error.errorCode).toBe("CANDIDATE_IDENTITY_INVALID");
    expect(requestRecord.error.code).toBe("CANDIDATE_SOURCE_IDENTITY_LOST");
    expect(existsSync(path.join(request.requestRoot, "candidate.json"))).toBe(false);
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an AI return cannot replace a retained source identity with a forged ID", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("candidate-identity-forgery.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(
      /data-pageroot-id="pr1_[a-f0-9]{32}"/u,
      'data-pageroot-id="pr1_ffffffffffff4fff8fffffffffffffff"',
    ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);

    const actionBar = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(actionBar).toContainText(
      "输出未保留现有源码元素身份，或包含重复、伪造的 Stable ID",
      { timeout: 30_000 },
    );
    const requestRecord = JSON.parse(readFileSync(
      path.join(request.requestRoot, "request.json"),
      "utf8",
    ));
    expect(requestRecord.status).toBe("error");
    expect(requestRecord.error.errorCode).toBe("CANDIDATE_IDENTITY_INVALID");
    expect(requestRecord.error.code).toBe("CANDIDATE_SOURCE_IDENTITY_FORGED");
    expect(existsSync(path.join(request.requestRoot, "candidate.json"))).toBe(false);
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
