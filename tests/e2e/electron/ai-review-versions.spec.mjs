import { expect, test } from "@playwright/test";
import {
  preserveCandidateSourceIdsForFixture,
} from "../../helpers/preserve-candidate-source-ids.mjs";
import {
  inspectSourceElementIdentity,
} from "../../../bridge/project-file-repository/working-copy.mjs";
import {
  LINE_SCOPE_AFTER,
  LINE_SCOPE_BEFORE,
  ORIGINAL_TEXT,
  OUTSIDE_MAIN_AFTER,
  OUTSIDE_MAIN_BEFORE,
  PICKER_TEXT,
  READABLE_REWRITE_AFTER,
  READABLE_REWRITE_BEFORE,
  REVIEW_MASK_UNION_BEFORE,
  REVIEW_METRIC_AFTER_CSS,
  REVIEW_METRIC_BEFORE_CSS,
  REVIEW_PROJECTION_CASES,
  SCOPE_PROMOTION_BEFORE,
  SECOND_UPDATED_TEXT,
  UPDATED_TEXT,
  addCommentAndSubmit,
  adoptReadyResult,
  assertOverlayMaskEquivalence,
  assertProjectionGeometryCase,
  assertReviewAcceptPersistence,
  assertReviewChangeOutline,
  assertReviewControlDefaults,
  assertReviewHasNoRuntimeVisualSupplement,
  caseSelector,
  candidateHtmlFiles,
  closePageRootGracefully,
  createSourceFixture,
  existsSync,
  focusChangeById,
  fixtureBuffer,
  launchPageRoot,
  loadedDiskFrame,
  managedProjectRootForId,
  mkdirSync,
  removeAiLoopUserData,
  removeSourceFixture,
  path,
  productRoot,
  readFileSync,
  realpathSync,
  rmSync,
  runOfficialFinalizer,
  sha256,
  stopPageRoot,
  workingHtmlFiles,
  writeAiOutput,
  writeFileSync,
} from "./ai-closed-loop-helpers.mjs";

test("two AI versions activate in order and survive relaunch without identity drift", async () => {
  test.setTimeout(240_000);
  const fixture = createSourceFixture("sequential-ai-loop.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  let activeApp = launched.electronApp;
  let activeAppClosed = false;
  try {
    const firstRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      firstRequest.requestRoot,
      (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    );
    runOfficialFinalizer(firstRequest.requestRoot, firstRequest.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/sequential-ai-loop-V2\.html$/u),
    });
    const firstActive = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect((await loadedDiskFrame(
      launched.page,
      firstActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(UPDATED_TEXT);

    const secondRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      firstActive.sourcePath,
      SECOND_UPDATED_TEXT,
    );
    writeAiOutput(
      secondRequest.requestRoot,
      (base) => base.replace(UPDATED_TEXT, SECOND_UPDATED_TEXT),
    );
    runOfficialFinalizer(secondRequest.requestRoot, secondRequest.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/sequential-ai-loop-V3\.html$/u),
    });
    const secondActive = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(readFileSync(firstActive.sourcePath, "utf8")).toContain(UPDATED_TEXT);
    expect(readFileSync(firstActive.sourcePath, "utf8"))
      .not.toContain(SECOND_UPDATED_TEXT);
    expect(readFileSync(secondActive.sourcePath, "utf8"))
      .toContain(SECOND_UPDATED_TEXT);
    await expect((await loadedDiskFrame(
      launched.page,
      secondActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(SECOND_UPDATED_TEXT);

    const projectRoot = managedProjectRootForId(
      launched.workspace,
      secondRequest.changeRequest.projectId,
    );
    expect(projectRoot).toBeTruthy();
    const manifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(manifest.projectId).toBe(secondRequest.changeRequest.projectId);
    expect(manifest.latestOfficialVersionId).toBe("ver_0003");
    expect(manifest.versions.map((version) => version.versionId))
      .toEqual(["ver_0001", "ver_0002", "ver_0003"]);

    await closePageRootGracefully(launched.electronApp, launched.page);
    activeAppClosed = true;
    const relaunched = await launchPageRoot({
      isolatedUserData: launched.isolatedUserData,
    });
    activeApp = relaunched.electronApp;
    activeAppClosed = false;
    await expect.poll(async () => (
      relaunched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: secondActive.sourcePath,
    });
    await expect((await loadedDiskFrame(
      relaunched.page,
      secondActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(SECOND_UPDATED_TEXT);
  } finally {
    if (activeAppClosed) {
      removeAiLoopUserData(launched.isolatedUserData);
    } else {
      await stopPageRoot(activeApp, launched.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("returning from review restores the editable pre-AI version and preserves the candidate", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("return-before-ai.html");
  const commentText = `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`;
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      request.requestRoot,
      (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    );
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    const candidateFiles = candidateHtmlFiles(
      launched.workspace,
      request.changeRequest.projectId,
    );
    expect(candidateFiles).toHaveLength(1);
    expect(readFileSync(candidateFiles[0], "utf8")).toContain(UPDATED_TEXT);

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "返回修改前" }).click();
    const dialog = launched.page.getByRole("dialog", {
      name: /返回 AI 修改前（版本 \d+）？/u,
    });
    await expect(dialog).toBeVisible();
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-return-confirmation.png"),
        animations: "disabled",
      });
    }
    await expect(dialog.getByText(/确认后不会采用这次 AI 返回的 版本 \d+。/u))
      .toBeVisible();
    await expect(dialog.getByText(/将继续使用 版本 \d+（AI 修改前）为基线重新修改。/u))
      .toBeVisible();
    const projectRoot = managedProjectRootForId(
      launched.workspace,
      request.changeRequest.projectId,
    );
    expect(projectRoot).toBeTruthy();
    const aiTasksRoot = path.join(projectRoot, "AI任务");
    rmSync(aiTasksRoot, { recursive: true, force: true });
    const revealCandidateTask = dialog.getByRole("button", {
      name: "AI 返回的 HTML 已自动保留，点击在文件夹中打开。",
    });
    await expect(revealCandidateTask).toBeVisible();
    await revealCandidateTask.click();
    await expect.poll(() => existsSync(aiTasksRoot), { timeout: 30_000 }).toBe(true);
    const [returnBackground, continueBackground] = await Promise.all([
      dialog.getByRole("button", { name: "返回修改前版本" })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      dialog.getByRole("button", { name: "继续审阅" })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    expect(returnBackground).not.toBe(continueBackground);
    await dialog.getByRole("button", { name: "返回修改前版本" }).click();

    await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
    const [workingCopyPath] = workingHtmlFiles(
      launched.workspace,
      request.changeRequest.projectId,
    );
    await loadedDiskFrame(launched.page, workingCopyPath);
    await expect(launched.page.locator(".comment-card").filter({ hasText: commentText }))
      .toHaveCount(1);
    const restored = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(restored.sourcePath).toBe(realpathSync(workingCopyPath));
    const runtime = JSON.parse(readFileSync(path.join(
      projectRoot,
      ".pageroot",
      "runtime-state.json",
    ), "utf8"));
    expect(runtime.schemaVersion).toBe("4.0.0");
    expect(runtime.activeRequest).toBeNull();
    expect(runtime.activeCandidateId).toBeNull();
    const candidate = JSON.parse(readFileSync(
      path.join(request.requestRoot, "candidate.json"),
      "utf8",
    ));
    const requestRecord = JSON.parse(readFileSync(
      path.join(request.requestRoot, "request.json"),
      "utf8",
    ));
    expect(candidate.status).toBe("rejected");
    expect(requestRecord.status).toBe("rejected");
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(existsSync(candidateFiles[0])).toBe(true);
    expect(readFileSync(candidateFiles[0], "utf8")).toContain(UPDATED_TEXT);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a broad but related AI return is accepted without a target-scope error", {
  tag: ["@gate-smoke","@smoke-review"],
}, async () => {
  const fixture = createSourceFixture();
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
        "<title>PageRoot native DOM editing matrix</title>",
        "<title>unauthorized title mutation</title>",
      ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await expect(launched.page.getByText("已记录评论范围外的额外变化", { exact: true }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采用这些额外变化" }))
      .toHaveCount(0);
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(active.sourcePath).toBe(realpathSync(
      workingHtmlFiles(launched.workspace, request.changeRequest.projectId)[0],
    ));
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a committed version that the desktop cannot activate stays visibly blocked", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: { PAGEROOT_E2E_GENERATED_VERSION_OPEN_FAILURE: "1" },
  });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect(launched.page.getByText(/新版本文件暂时无法打开|最新版暂时无法打开/u)
      .filter({ visible: true }).first())
      .toBeVisible({ timeout: 30_000 });
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).toBe(realpathSync(request.sourcePath));
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(2);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("stable-ID Review keeps movement, reorder, attributes and styles position-bound", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  const fixture = createSourceFixture("stable-id-review.html", (source) => source.replace(
    "  </main>",
    `    <style data-stable-review-css>.stable-review-card { color: rgb(30 40 50); }</style>
    <section data-stable-review-root>
      <div data-stable-review-column="a">
        <article data-stable-review-card data-review-status="before" style="padding: 8px">
          <h2>稳定卡片</h2><p>移动前文字</p>
        </article>
        <article data-stable-review-static data-review-static="before" style="margin: 4px">
          <h2>原位卡片</h2><p>原位修改前文字</p>
        </article>
        <article data-stable-review-unchanged-move><p>跨区移动但文字不变</p></article>
        <article data-stable-review-id-deleted><h2>相同身份标题</h2><p>删除 ID 但内容不变</p></article>
        <article data-stable-review-id-replaced><h2>相同身份标题</h2><p>替换 ID 但标记不变</p></article>
        <article data-stable-review-composite-move>
          <p data-stable-review-transfer-from>待转移文字</p>
          <p data-stable-review-transfer-to>稳定乙</p>
          <aside data-stable-review-removed-module>移动时删除的模块</aside>
        </article>
        <p data-stable-review-order="a">稳定顺序甲</p>
        <p data-stable-review-order="b">稳定顺序乙</p>
      </div>
      <div data-stable-review-column="b"></div>
      <article data-stable-review-exact="a">精确重排甲</article>
      <article data-stable-review-exact="b">精确重排乙</article>
    </section>
    <script type="application/json" data-stable-review-script>{"state":"before"}</script>
  </main>`,
  ));
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath);
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => {
      const card = base.match(/<article data-stable-review-card[\s\S]*?<\/article>/u)?.[0];
      const staticCard = base.match(/<article data-stable-review-static[\s\S]*?<\/article>/u)?.[0];
      const unchangedMove = base.match(/<article data-stable-review-unchanged-move[\s\S]*?<\/article>/u)?.[0];
      const compositeMove = base.match(/<article data-stable-review-composite-move[\s\S]*?<\/article>/u)?.[0];
      const orderA = base.match(/<p data-stable-review-order="a"[^>]*>稳定顺序甲<\/p>/u)?.[0];
      const orderB = base.match(/<p data-stable-review-order="b"[^>]*>稳定顺序乙<\/p>/u)?.[0];
      const exactA = base.match(/<article data-stable-review-exact="a"[^>]*>精确重排甲<\/article>/u)?.[0];
      const exactB = base.match(/<article data-stable-review-exact="b"[^>]*>精确重排乙<\/article>/u)?.[0];
      expect(card).toBeTruthy();
      expect(staticCard).toBeTruthy();
      expect(unchangedMove).toBeTruthy();
      expect(compositeMove).toBeTruthy();
      expect(orderA).toBeTruthy();
      expect(orderB).toBeTruthy();
      expect(exactA).toBeTruthy();
      expect(exactB).toBeTruthy();
      const movedCard = card
        .replace('data-review-status="before"', 'data-review-status="after"')
        .replace('style="padding: 8px"', 'style="padding: 18px; border: 2px solid #6d5ce7"')
        .replace("移动前文字", "移动后文字");
      const changedStaticCard = staticCard
        .replace('data-review-static="before"', 'data-review-static="after"')
        .replace('style="margin: 4px"', 'style="margin: 14px; color: rgb(90 40 150)"')
        .replace("原位修改前文字", "原位修改后文字");
      const changedCompositeMove = compositeMove
        .replace("待转移文字", "稳定甲")
        .replace("稳定乙", "待转移文字")
        .replace(/\s*<aside data-stable-review-removed-module[\s\S]*?<\/aside>/u, "")
        .replace(
          "</article>",
          '<img data-stable-review-added-image alt="移动时新增的图片" src="data:image/svg+xml,%3Csvg/%3E"></article>',
        );
      return base
        .replace(ORIGINAL_TEXT, UPDATED_TEXT)
        .replace(
          "</head>",
          '<style data-stable-review-added-css>.added-source { font-weight: 600; }</style></head>',
        )
        .replace(
          "</body>",
          '<script type="application/json" data-stable-review-added-script>{"added":true}</script></body>',
        )
        .replace(card, "")
        .replace(compositeMove, "")
        .replace(staticCard, changedStaticCard)
        .replace(unchangedMove, "")
        .replace(`${orderA}\n        ${orderB}`, `${orderB}\n        ${orderA}`)
        .replace(`${exactA}\n      ${exactB}`, `${exactB}\n      ${exactA}`)
        .replace(
          /(<div data-stable-review-column="b"[^>]*>)/u,
          `$1\n        ${movedCard}\n        ${unchangedMove}\n        ${changedCompositeMove}`,
        );
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const beforeFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator("html")).toHaveAttribute(
        "data-pageroot-review-filter",
        "all",
        { timeout: 30_000 },
      );
    }

    const structureKinds = async (locator) => JSON.parse(
      await locator.getAttribute("data-pageroot-review-projection-facts") || "[]",
    ).filter((fact) => fact.type === "structure")
      .map((fact) => fact.structureChange);
    for (const frame of [beforeFrame, afterFrame]) {
      const card = frame.locator("[data-stable-review-card]");
      await expect(card).toHaveAttribute("data-pageroot-review-marker", /change-/u);
      await expect.poll(() => structureKinds(card)).toEqual(expect.arrayContaining([
        "moved",
        "attribute",
        "style",
      ]));
      await expect.poll(() => structureKinds(frame.locator("html"))).toEqual([]);
      const falsePresenceFacts = await card.evaluate((element) => (
        JSON.parse(element.getAttribute("data-pageroot-review-projection-facts") || "[]")
          .filter((fact) => fact.structureChange === "added" || fact.structureChange === "removed")
      ));
      expect(falsePresenceFacts).toEqual([]);
    }
    for (const frame of [beforeFrame, afterFrame]) {
      const compositeMove = frame.locator("[data-stable-review-composite-move]");
      await expect.poll(() => structureKinds(compositeMove)).toEqual(
        expect.arrayContaining(["moved"]),
      );
      await expect(compositeMove).toHaveAttribute(
        "data-pageroot-review-marker",
        /change-/u,
      );
    }
    await expect(beforeFrame.locator(
      '[data-stable-review-transfer-from] [data-pageroot-review-text="removed"], [data-stable-review-transfer-from][data-pageroot-review-text="removed"]',
    ).first()).toContainText("待转移文字");
    await expect(afterFrame.locator(
      '[data-stable-review-transfer-to] [data-pageroot-review-text="added"], [data-stable-review-transfer-to][data-pageroot-review-text="added"]',
    ).first()).toContainText("待转移文字");
    const movedTextOwners = await beforeFrame.locator(
      '[data-stable-review-card] [data-pageroot-review-text="removed"], [data-stable-review-transfer-from] [data-pageroot-review-text="removed"]',
    ).evaluateAll((elements) => elements.map((element) => (
      element.getAttribute("data-pageroot-review-semantic-owner") || ""
    )).filter(Boolean));
    expect(movedTextOwners).toHaveLength(2);
    expect(new Set(movedTextOwners).size).toBe(2);
    await expect.poll(() => structureKinds(afterFrame.locator(
      "[data-stable-review-added-image]",
    ))).toEqual(expect.arrayContaining(["added"]));
    await expect.poll(() => structureKinds(beforeFrame.locator(
      "[data-stable-review-removed-module]",
    ))).toEqual(expect.arrayContaining(["removed"]));
    const addedCss = afterFrame.locator("[data-stable-review-added-css]");
    const addedScript = afterFrame.locator("[data-stable-review-added-script]");
    await expect(addedCss).toHaveAttribute("data-pageroot-id", /^pr1_[a-f0-9]{32}$/u);
    await expect(addedScript).toHaveAttribute("data-pageroot-id", /^pr1_[a-f0-9]{32}$/u);
    expect(await addedCss.getAttribute("data-pageroot-id"))
      .not.toBe(await addedScript.getAttribute("data-pageroot-id"));
    for (const sourceElement of [addedCss, addedScript]) {
      await expect(sourceElement).not.toHaveAttribute("data-pageroot-review-marker", /change-/u);
    }
    await expect(beforeFrame.locator(
      '[data-stable-review-card] [data-pageroot-review-text="removed"], [data-stable-review-card][data-pageroot-review-text="removed"]',
    ).first()).toBeAttached();
    await expect(afterFrame.locator(
      '[data-stable-review-card] [data-pageroot-review-text="added"], [data-stable-review-card][data-pageroot-review-text="added"]',
    ).first()).toBeAttached();
    for (const frame of [beforeFrame, afterFrame]) {
      const unchangedMove = frame.locator("[data-stable-review-unchanged-move]");
      await expect.poll(() => structureKinds(unchangedMove)).toEqual(
        expect.arrayContaining(["moved"]),
      );
      await expect(unchangedMove.locator("[data-pageroot-review-text]")).toHaveCount(0);
      await expect.poll(async () => (
        JSON.parse(await unchangedMove.getAttribute("data-pageroot-review-projection-facts") || "[]")
          .filter((fact) => fact.type === "text")
      )).toEqual([]);
    }
    for (const [frame, tone] of [[beforeFrame, "removed"], [afterFrame, "added"]]) {
      const staticCard = frame.locator("[data-stable-review-static]");
      await expect.poll(() => structureKinds(staticCard)).toEqual(expect.arrayContaining([
        "attribute",
        "style",
      ]));
      await expect(frame.locator(
        `[data-stable-review-static] [data-pageroot-review-text="${tone}"], [data-stable-review-static][data-pageroot-review-text="${tone}"]`,
      ).first()).toBeAttached();
    }
    for (const frame of [beforeFrame, afterFrame]) {
      await expect.poll(() => structureKinds(frame.locator('[data-stable-review-column="a"]')))
        .toEqual(expect.arrayContaining(["reordered"]));
      await expect.poll(() => structureKinds(frame.locator("[data-stable-review-root]")))
        .toEqual(expect.arrayContaining(["reordered"]));
      await expect(frame.locator(
        '[data-stable-review-order="a"] [data-pageroot-review-text], '
        + '[data-stable-review-order="b"] [data-pageroot-review-text], '
        + '[data-stable-review-exact="a"] [data-pageroot-review-text], '
        + '[data-stable-review-exact="b"] [data-pageroot-review-text]',
      )).toHaveCount(0);
    }
    await launched.page.getByRole("button", { name: "元素变化" }).click();
    // Several source-backed structure regions may overlap. Activate the exact
    // analyzer-owned bar rather than asking pointer hit-testing to choose the
    // topmost sibling at the same coordinates.
    await afterFrame.locator("[data-pageroot-review-region-bar]").first()
      .evaluate((bar) => bar.click());
    await expect.poll(() => afterFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).count()).toBeGreaterThan(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a rewrite outside <main> is still reviewed", {
  tag: ["@gate-smoke","@smoke-review"],
}, async () => {
  // A single-file page has no site chrome to skip: the reader can comment on a
  // footer note, the AI can rewrite it, and the review must show that change
  // instead of reporting the page as unchanged there.
  const fixture = createSourceFixture(
    "outside-main-review.html",
    (source) => source.replace(
      "</body>",
      `  <footer data-review-outside-main>
    <p>${OUTSIDE_MAIN_BEFORE}</p>
  </footer>
</body>`,
    ),
  );
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => {
      expect(base).toContain(OUTSIDE_MAIN_BEFORE);
      return base
        .replace(ORIGINAL_TEXT, UPDATED_TEXT)
        .replace(OUTSIDE_MAIN_BEFORE, OUTSIDE_MAIN_AFTER);
    });
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
        "data-pageroot-review-filter",
        "all",
        { timeout: 30_000 },
      );
    }
    // The footer is a body-level sibling of <main>, so it must become its own
    // change region carrying text evidence on both sides.
    await expect(beforeReviewFrame.locator("[data-review-outside-main]"))
      .toHaveAttribute("data-pageroot-review-types", /text/u, { timeout: 30_000 });
    await expect(afterReviewFrame.locator("[data-review-outside-main]"))
      .toHaveAttribute("data-pageroot-review-types", /text/u);
    await expect(beforeReviewFrame.locator(
      '[data-review-outside-main] [data-pageroot-review-text="removed"]',
    ).filter({ hasText: "不同" }).first()).toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-review-outside-main] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "一致" }).first()).toBeVisible();
    // 品牌与 About 入口由全局侧边栏统一承担，审阅页不复制同形顶栏图标。
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    if (await sidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    }
    await sidebar.getByRole("button", { name: "源页", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "关闭关于源页" }))
      .toBeVisible({ timeout: 15_000 });
    await launched.page.getByRole("button", { name: "关闭关于源页" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Review keeps Candidate scope diagnostics out of the comparison canvas", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("candidate-impact-review.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
      UPDATED_TEXT,
    );
    writeAiOutput(request.requestRoot, (base) => {
      const changedTitle = base.replace(
        /(<title[^>]*>)[\s\S]*?(<\/title>)/u,
        "$1AI 任务标题$2",
      );
      return changedTitle.replace(ORIGINAL_TEXT, UPDATED_TEXT);
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByTestId("review-impact-summary")).toHaveCount(0);
    await expect(launched.page.getByTestId("review-visual-status")).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采纳修改" }))
      .toBeVisible();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("CSS and Script comment-only changes stay out of Review", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("source-only-diagnostics.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base
      .replace("    :root {", "    /* source-only QA */\n    :root {")
      .replace(
        'document.documentElement.dataset.authorScriptRan = "true";',
        '/* source-only QA */ document.documentElement.dataset.authorScriptRan = "true";',
      ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
    await expect(launched.page.locator(".toast"))
      .toContainText("这次没有产生有效变化", { timeout: 30_000 });
    await expect(launched.page.locator(".toast"))
      .toContainText("没有找到能够定位到页面具体位置的内容、结构或视觉变化");
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a safe simple CSS selector creates one position-bound element change", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("mapped-css-review.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(
      "  </style>",
      '    [data-native-case="vertical-copy"] { color: rgb(180, 20, 30); }\n  </style>',
    ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const beforeFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    for (const frame of [beforeFrame, afterFrame]) {
      await expect(frame.locator('[data-native-case="vertical-copy"]'))
        .toHaveAttribute("data-pageroot-review-structure", "style");
      await expect(frame.locator('[data-native-case="vertical-copy"]'))
        .toHaveAttribute("data-pageroot-review-confirmed", "true");
    }
    await expect(afterFrame.locator('[data-pageroot-review-structure="style"]'))
      .toHaveCount(1);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("source Review preserves multi-host text evidence and hidden changes without visual confirmation", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  test.setTimeout(120_000);
  const SECTION_ID = "pr1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";
  const FIRST_ID = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const SECOND_ID = "pr1_cccccccccccc4ccc8ccccccccccccccc";
  const HIDDEN_ID = "pr1_dddddddddddd4ddd8ddddddddddddddd";
  const fixture = createSourceFixture("multi-host-hidden-review.html", (source) => source.replace(
    "  </main>",
    `    <p data-review-multi-host data-pageroot-id="${SECTION_ID}">
      <span data-pageroot-id="${FIRST_ID}">第一段旧文字</span>
      <span data-pageroot-id="${SECOND_ID}">第二段旧文字</span>
    </p>
    <div style="display:none!important;visibility:hidden;opacity:0" data-review-hidden-source data-pageroot-id="${HIDDEN_ID}">隐藏旧文字</div>
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
      .replace("第一段旧文字", "第一段新文字")
      .replace("第二段旧文字", "第二段新文字")
      .replace("隐藏旧文字", "隐藏新文字"));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });

    const beforeFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    const addedMarkers = afterFrame.locator(
      '[data-review-multi-host] [data-pageroot-review-text="added"]',
    );
    await expect(addedMarkers.filter({ hasText: "新" })).toHaveCount(2);
    const changeIds = await addedMarkers.filter({ hasText: "新" }).evaluateAll((elements) => (
      elements.map((element) => element.getAttribute("data-pageroot-review-marker"))
    ));
    expect(new Set(changeIds).size).toBe(1);
    await expect(beforeFrame.locator(
      '[data-review-multi-host] [data-pageroot-review-text="removed"]',
    ).filter({ hasText: "旧" })).toHaveCount(2);

    const hiddenAfter = afterFrame.locator("[data-review-hidden-source]");
    await expect(hiddenAfter).toBeAttached();
    await expect(hiddenAfter.locator('[data-pageroot-review-text="added"]'))
      .toBeAttached();
    await expect(hiddenAfter.locator('[data-pageroot-review-text="added"]'))
      .toHaveAttribute("data-pageroot-review-confirmed", "true");
    await expect(launched.page.getByTestId("review-visual-status")).toHaveCount(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

const STATIC_ACCEPT_UNLOCK_MS = 3_000;
const ACCEPT_SCROLL_ANCHOR = "accept-scroll-anchor";

async function holdEditRuntimePrepare(electronApp) {
  const available = await electronApp.evaluate(
    () => typeof globalThis.__pagerootE2eHoldEditRuntimePrepare,
  );
  expect(available).toBe("function");
  await electronApp.evaluate(() => {
    globalThis.__pagerootE2eHoldEditRuntimePrepare();
  });
}

async function releaseEditRuntimePrepare(electronApp) {
  await electronApp.evaluate(() => {
    globalThis.__pagerootE2eReleaseEditRuntimePrepare();
  });
}

async function readActiveAcceptSnapshot(page) {
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  const chrome = await page.evaluate(() => {
    const workbench = document.querySelector("main.workbench");
    const visibleEditor = [...document.querySelectorAll('[data-testid="html-canvas-editor"]')]
      .find((node) => node.getClientRects().length > 0) || null;
    const surface = visibleEditor?.closest(".canvas-edit-surface") || null;
    const commentButton = document.querySelector(
      'aside[aria-label="本轮评论"] button[aria-label="全局评论"]',
    );
    return {
      projectState: workbench?.getAttribute("data-project-state") || "",
      renderedSha256: workbench?.getAttribute("data-rendered-sha256") || "",
      runtimePhase: surface?.getAttribute("data-edit-runtime-phase") || "",
      runtimeHandoff: visibleEditor?.getAttribute("data-runtime-handoff") || "",
      runtimeCandidateId: visibleEditor?.getAttribute("data-runtime-candidate-id") || "",
      renderVerified: visibleEditor?.getAttribute("data-render-verified") || "",
      editorLocked: visibleEditor?.getAttribute("data-locked") === "true",
      commentEnabled: Boolean(commentButton) && !commentButton.disabled,
      reviewVisible: Boolean(document.querySelector('[data-testid="ai-review-workspace"]')),
      accepting: Boolean(
        [...document.querySelectorAll("button")].some((button) => (
          /正在采纳/.test(button.textContent || "")
          || /正在采纳/.test(button.getAttribute("aria-label") || "")
        )),
      ),
      unlockCount: Number(window.__pagerootCommentUnlockCount || 0),
    };
  });
  const project = await page.evaluate(() => window.htmlAIProjects?.getActiveProject());
  const frameFacts = {
    listItemText: "",
    scrollY: 0,
    outerScrollTop: 0,
    showingDocumentTop: true,
    anchorInViewport: false,
    anchorScreenTop: 0,
    clipTop: 0,
    clipBottom: 0,
    iframeHeight: 0,
  };
  try {
    if (await editor.count()) {
      const frame = page.frameLocator(
        '[data-testid="html-canvas-editor"]:visible iframe[data-runtime-slot-role="active"]',
      );
      frameFacts.listItemText = (
        await frame.locator(caseSelector("list-item")).textContent({ timeout: 500 }).catch(() => "")
      ) || "";
      const inner = await frame.locator(caseSelector(ACCEPT_SCROLL_ANCHOR)).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const view = node.ownerDocument.defaultView;
        return {
          top: rect.top,
          bottom: rect.bottom,
          scrollY: Number(view?.scrollY || 0),
        };
      }).catch(() => null);
      const chromeGeometry = await page.evaluate(() => {
        const stage = document.querySelector(".review-scroll-stage");
        const iframe = [...document.querySelectorAll(
          '[data-testid="html-canvas-editor"] iframe[data-runtime-slot-role="active"]',
        )].find((node) => node.getClientRects().length > 0) || null;
        const stageRect = stage?.getBoundingClientRect();
        const iframeRect = iframe?.getBoundingClientRect();
        return {
          outerScrollTop: Number(stage?.scrollTop || 0),
          stageTop: stageRect?.top ?? 0,
          stageBottom: stageRect?.bottom ?? 0,
          iframeTop: iframeRect?.top ?? 0,
          iframeBottom: iframeRect?.bottom ?? 0,
          iframeHeight: iframeRect?.height ?? 0,
        };
      });
      frameFacts.scrollY = inner?.scrollY || 0;
      frameFacts.outerScrollTop = chromeGeometry.outerScrollTop;
      if (inner) {
        const screenTop = chromeGeometry.iframeTop + inner.top;
        const screenBottom = chromeGeometry.iframeTop + inner.bottom;
        const clipTop = Math.max(chromeGeometry.stageTop, chromeGeometry.iframeTop);
        const clipBottom = Math.min(chromeGeometry.stageBottom, chromeGeometry.iframeBottom);
        frameFacts.anchorInViewport = screenBottom > clipTop + 8
          && screenTop < clipBottom - 8;
        frameFacts.showingDocumentTop = chromeGeometry.outerScrollTop < 80
          && frameFacts.scrollY < 80
          && inner.top < 80;
        frameFacts.anchorScreenTop = screenTop;
        frameFacts.clipTop = clipTop;
        frameFacts.clipBottom = clipBottom;
        frameFacts.iframeHeight = chromeGeometry.iframeHeight;
      }
    }
  } catch {
    // Active iframe may detach for one frame during the static rewrite.
  }
  return {
    ...chrome,
    ...frameFacts,
    sourcePath: project?.sourcePath || "",
    workingSha256: project?.sha256 || project?.sourceSha256 || "",
  };
}

test("accepting a Version shows static Active and unlocks editing before Runtime is granted", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("accept-static-first.html", (source) => source.replace(
    "  </main>",
    `    <div data-scroll-pad="before" style="height:1800px" aria-hidden="true"></div>
    <p data-native-case="${ACCEPT_SCROLL_ANCHOR}">滚动锚点保持可见</p>
    <div data-scroll-pad="after" style="height:1800px" aria-hidden="true"></div>
  </main>`,
  ));
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const openedFrame = await loadedDiskFrame(launched.page, fixture.sourcePath);
    const scrollAnchor = openedFrame.locator(caseSelector(ACCEPT_SCROLL_ANCHOR));
    await expect(scrollAnchor).toBeVisible();
    const anchorDocumentTop = await scrollAnchor.evaluate((element) => (
      element.getBoundingClientRect().top
      + Number(element.ownerDocument.defaultView?.scrollY || 0)
    ));
    await launched.page.locator(".review-scroll-stage").evaluate((stage, documentTop) => {
      const iframe = [...stage.querySelectorAll(
        '[data-testid="html-canvas-editor"] iframe[data-runtime-slot-role="active"]',
      )].find((node) => node.getClientRects().length > 0);
      if (!iframe) return;
      const iframeOffset = iframe.getBoundingClientRect().top
        - stage.getBoundingClientRect().top
        + stage.scrollTop;
      stage.scrollTop = Math.max(0, iframeOffset + documentTop - stage.clientHeight / 2);
    }, anchorDocumentTop);
    await expect.poll(async () => {
      const snapshot = await readActiveAcceptSnapshot(launched.page);
      return snapshot.outerScrollTop > 400 && snapshot.anchorInViewport && !snapshot.showingDocumentTop
        ? snapshot
        : false;
    }).toBeTruthy();

    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => preserveCandidateSourceIdsForFixture(
      base,
      base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });

    await launched.page.evaluate(() => {
      const button = document.querySelector(
        'aside[aria-label="本轮评论"] button[aria-label="全局评论"]',
      );
      window.__pagerootCommentUnlockCount = 0;
      window.__pagerootCommentWasDisabled = Boolean(button?.disabled);
      window.__pagerootCommentUnlockObserver?.disconnect();
      window.__pagerootCommentUnlockObserver = new MutationObserver(() => {
        const locked = Boolean(button?.disabled);
        if (window.__pagerootCommentWasDisabled && !locked) {
          window.__pagerootCommentUnlockCount += 1;
        }
        window.__pagerootCommentWasDisabled = locked;
      });
      if (button) {
        window.__pagerootCommentUnlockObserver.observe(button, {
          attributes: true,
          attributeFilter: ["disabled"],
        });
      }
    });
    await holdEditRuntimePrepare(launched.electronApp);
    await adoptReadyResult(launched.page);
    await launched.page.getByRole("button", { name: "确认并采纳" })
      .click({ timeout: 5_000 })
      .catch(() => undefined);

    await expect.poll(async () => {
      const snapshot = await readActiveAcceptSnapshot(launched.page);
      const runtimeStillIdle = snapshot.runtimeHandoff !== "active"
        && !snapshot.runtimeCandidateId;
      const ready = !snapshot.reviewVisible
        && !snapshot.accepting
        && runtimeStillIdle
        && snapshot.renderVerified === "true"
        && snapshot.listItemText === UPDATED_TEXT
        && snapshot.commentEnabled
        && !snapshot.editorLocked
        && !snapshot.showingDocumentTop
        && snapshot.anchorInViewport;
      return {
        ...snapshot,
        ready,
        runtimeStillIdle,
        geometry: ready
          ? undefined
          : `${snapshot.outerScrollTop}|${snapshot.iframeHeight}|${snapshot.anchorScreenTop}|${snapshot.clipTop}|${snapshot.clipBottom}|${snapshot.scrollY}`,
      };
    }, { timeout: STATIC_ACCEPT_UNLOCK_MS }).toMatchObject({
      ready: true,
      runtimeStillIdle: true,
      reviewVisible: false,
      accepting: false,
      renderVerified: "true",
      listItemText: UPDATED_TEXT,
      commentEnabled: true,
      editorLocked: false,
      showingDocumentTop: false,
      anchorInViewport: true,
      projectState: "ready",
      runtimeCandidateId: "",
      geometry: undefined,
    });
    const unlocked = await readActiveAcceptSnapshot(launched.page);
    expect(["preparing", "static", "recovering"]).toContain(unlocked.runtimePhase);
    expect(unlocked.sourcePath).toMatch(/\/accept-static-first-V2\.html$/u);
    const expectedSha256 = sha256(readFileSync(unlocked.sourcePath));
    expect(unlocked.workingSha256).toBe(expectedSha256);
    const unlocksAtStatic = unlocked.unlockCount;

    await releaseEditRuntimePrepare(launched.electronApp);
    await expect.poll(async () => {
      const snapshot = await readActiveAcceptSnapshot(launched.page);
      return snapshot.runtimePhase === "settled"
        || snapshot.runtimeHandoff === "active"
        || snapshot.runtimeCandidateId
        ? snapshot
        : false;
    }, { timeout: 20_000 }).toBeTruthy();
    const promoted = await readActiveAcceptSnapshot(launched.page);
    expect(promoted.listItemText).toBe(UPDATED_TEXT);
    expect(promoted.sourcePath).toBe(unlocked.sourcePath);
    expect(promoted.workingSha256).toBe(expectedSha256);
    expect(promoted.commentEnabled).toBe(true);
    expect(promoted.unlockCount).toBe(unlocksAtStatic);
    expect(promoted.showingDocumentTop).toBe(false);
    expect(promoted.anchorInViewport).toBe(true);
    expect(promoted.listItemText).not.toBe(ORIGINAL_TEXT);
  } finally {
    await releaseEditRuntimePrepare(launched.electronApp).catch(() => {});
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
