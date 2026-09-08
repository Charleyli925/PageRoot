import { expect, test } from "@playwright/test";
import {
  addComment, candidateHtmlFiles, chooseModifyIntent, createCodexAcpE2ECommand,
  createSourceFixture, expandSettingsAgent, launchPageRoot, mkdirSync,
  openAgentSettingsPage, pagerootHttpAgentEnv, path, productRoot, readFileSync,
  removeSourceFixture, setDefaultSettingsAgent, startPagerootHttpAgent, stopPageRoot,
  loadedDiskFrame,
} from "./ai-closed-loop-helpers.mjs";

const screenshots = path.join(productRoot, "output/design-qa/agent-setup-journeys");
mkdirSync(screenshots, { recursive: true });

test("non-default DeepSeek saves high through restart and sends high, with compact settings and narrow progress", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("agent-setup-journey.html");
  const codexCommand = createCodexAcpE2ECommand(fixture.sourceDirectory);
  let finish;
  const complete = new Promise((resolve) => { finish = resolve; });
  const httpAgent = await startPagerootHttpAgent({ beforeStreamComplete: () => complete, streamDelayMs: 100 });
  const injectedEnv = {
    PAGEROOT_CODEX_ACP_ALLOW_TEST_COMMAND: "1",
    PAGEROOT_CODEX_ACP_COMMAND: codexCommand,
    ...pagerootHttpAgentEnv(httpAgent.baseUrl),
  };
  let launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath, injectedEnv });
  let profile = launched.isolatedUserData;
  try {
    const workingPath = await addComment(launched.page, fixture.sourcePath, "请调整标题，保留其余内容。");
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    let settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "codex");
    await setDefaultSettingsAgent(settings, "codex");
    await expandSettingsAgent(settings, "pageroot");
    let card = settings.locator(".pageroot-availability-card");
    const checkbox = card.getByRole("checkbox");
    await expect(checkbox).toBeVisible();
    const bounds = await checkbox.boundingBox();
    expect(bounds.width).toBe(16);
    expect(bounds.height).toBe(16);
    await launched.page.screenshot({ path: path.join(screenshots, "settings-key-form.png"), animations: "disabled" });
    await card.getByRole("textbox", { name: "API Key" }).fill("sk-e2e-journey");
    await card.getByRole("button", { name: "连接", exact: true }).click();
    await expect(settings.getByTestId("settings-agent-row-pageroot")).toContainText("DeepSeek · 已连接");
    const modelChoice = card.getByRole("combobox", { name: "当前模型" });
    await expect(modelChoice.locator("option")).toHaveCount(3);
    for (const model of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"]) {
      await modelChoice.selectOption(`pageroot:${model}`);
      await expect(modelChoice).toHaveValue(`pageroot:${model}`);
    }
    await card.getByRole("combobox", { name: "思考深度" }).selectOption("high");
    await expect(card.getByRole("combobox", { name: "思考深度" })).toHaveValue("high");
    await expect(settings.getByTestId("settings-agent-row-codex").locator(".settings-agent-default-badge")).toBeVisible();
    await expect(card.locator(".qoder-card-status")).toHaveCount(0);
    await expect(card.getByTestId("agent-credential-summary")).toContainText("仅本次使用");
    await settings.getByTestId("settings-agent-row-pageroot").locator(".settings-agent-service-main").click();
    await expandSettingsAgent(settings, "pageroot");
    await expect(card.getByRole("combobox", { name: "思考深度" })).toHaveValue("high");
    await expect.poll(() => JSON.parse(readFileSync(path.join(profile, "ui-preferences.json"), "utf8"))
      .workspace?.agentConfigurations?.pageroot?.reasoning).toBe("high");
    await launched.page.screenshot({ path: path.join(screenshots, "settings-deepseek-high.png"), animations: "disabled" });
    await stopPageRoot(launched.electronApp, profile, { cleanup: false });
    launched = await launchPageRoot({ isolatedUserData: profile, injectedEnv });
    settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "pageroot");
    card = settings.locator(".pageroot-availability-card");
    // This isolated fixture intentionally does not restore a real credential.
    // Reconnecting the same service must also preserve its saved configuration.
    await card.getByRole("textbox", { name: "API Key" }).fill("sk-e2e-journey");
    await card.getByRole("button", { name: "连接", exact: true }).click();
    await expect(card.getByRole("combobox", { name: "思考深度" })).toHaveValue("high");
    await expect(settings.getByTestId("settings-agent-row-codex").locator(".settings-agent-default-badge")).toBeVisible();
    await setDefaultSettingsAgent(settings, "pageroot");
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const sidebar = await chooseModifyIntent(launched.page);
    await sidebar.getByTestId("ai-conversation-agent").click();
    await sidebar.getByTestId("ai-conversation-service-pageroot").click();
    await expect(launched.page.getByText(/设置暂未保存|选择未保存|工作台偏好记录无效/u)).toHaveCount(0);
    await expect.poll(() => Object.values(JSON.parse(readFileSync(path.join(profile, "ui-preferences.json"), "utf8"))
      .workspace?.documentAgentSelections || {})).toContain("pageroot");
    const original = readFileSync(workingPath);
    await sidebar.getByRole("button", { name: /交给.*修改/u }).click();
    const progress = sidebar.getByTestId("ai-conversation-run-progress");
    await expect(progress).toContainText("DeepSeek 正在生成");
    await expect(progress).toContainText("正在接收结果");
    await expect(sidebar.getByTestId("ai-conversation-action-bar").getByRole("button", { name: "停止", exact: true })).toBeVisible();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toHaveCount(1);
    const narration = sidebar.getByTestId("ai-conversation-narration-message");
    await expect(narration).toContainText("我会先检查页面结构");
    await expect(narration).toContainText("标题与配色已调整");
    await expect(narration).not.toContainText("fixture-hidden");
    await expect(narration).not.toContainText("<!DOCTYPE");
    const draft = sidebar.getByRole("textbox", { name: "下一轮草稿" });
    await draft.fill("下一轮再调整页脚间距");
    await expect(draft).toHaveValue("下一轮再调整页脚间距");
    await expect(sidebar.getByTestId("ai-turn-process").first().locator("li").first()).toBeVisible();
    await expect(sidebar.getByTestId("ai-conversation-run-summary")).toHaveCount(0);
    await expect(sidebar.getByText("Thinking", { exact: true })).toHaveCount(0);
    expect(readFileSync(workingPath).equals(original)).toBe(true);
    await launched.page.screenshot({ path: path.join(screenshots, "narrow-sidebar-generating.png"), animations: "disabled" });
    finish();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    await expect(sidebar.getByTestId("ai-conversation-run-summary")).toHaveCount(0);
    const active = await launched.page.evaluate(() => window.htmlAIProjects.getActiveProject());
    const candidates = candidateHtmlFiles(launched.workspace, active.projectId);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((file) => readFileSync(file, "utf8").includes('data-pageroot-http-reasoning="high"'))).toBe(true);
    expect(readFileSync(workingPath).equals(original)).toBe(true);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await sidebar.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "采纳修改", exact: true })).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采用修改", exact: true })).toHaveCount(1);
    await expect(draft).toHaveValue("下一轮再调整页脚间距");
    const layout = await sidebar.evaluate((element) => {
      const draft = element.querySelector('[data-testid="ai-conversation-composer"]').getBoundingClientRect();
      const actions = element.querySelector('[data-testid="ai-conversation-current-actions"]').getBoundingClientRect();
      return { gap: draft.top - actions.bottom, bottom: element.getBoundingClientRect().bottom - draft.bottom };
    });
    expect(Math.abs(layout.gap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.bottom)).toBeLessThanOrEqual(1);
    const review = launched.page.getByTestId("ai-review-workspace");
    for (const index of [0, 1]) {
      await expect(review.frameLocator("iframe").nth(index).locator("body")).toContainText("真实");
    }
    await launched.page.screenshot({ path: path.join(screenshots, "review-result.png"), animations: "disabled" });
    await stopPageRoot(launched.electronApp, profile, { cleanup: false });
    launched = await launchPageRoot({ isolatedUserData: profile, injectedEnv });
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    await expect(launched.page.getByRole("textbox", { name: "下一轮草稿" })).toHaveValue("下一轮再调整页脚间距");
  } finally {
    finish();
    await stopPageRoot(launched.electronApp, profile);
    await httpAgent.close();
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Codex authenticated component failure repairs in Settings, then reviews and completes two rounds", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("codex-recovery-journey.html");
  const command = createCodexAcpE2ECommand(fixture.sourceDirectory, { javascript: true });
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath, injectedEnv: {
    PAGEROOT_CODEX_ACP_ALLOW_TEST_COMMAND: "1", PAGEROOT_CODEX_ACP_COMMAND: command,
  } });
  let broken = false;
  let installs = 0;
  try {
    await launched.page.route("**/agent/diagnose?*", async (route) => {
      const selection = JSON.parse(new URL(route.request().url()).searchParams.get("selection") || "{}");
      if (!broken || selection.providerId !== "codex") return route.continue();
      return route.fulfill({ json: { status: "unavailable", diagnostic: {
        readiness: "connection-failed", cause: "CODEX_PREFLIGHT_FAILED", operation: "diagnose",
        facts: { installation: "ready", authentication: "ready", protocol: "failed", service: "unknown" },
      } } });
    });
    await launched.page.route("**/agent/install", async (route) => {
      installs += 1;
      broken = false;
      return route.fulfill({ json: { providerId: "codex", installState: "idle" } });
    });
    const workingPath = await addComment(launched.page, fixture.sourcePath, "调整标题。");
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "codex");
    await setDefaultSettingsAgent(settings, "codex");
    broken = true;
    await settings.locator(".settings-secondary-action").filter({ hasText: "重新检查" }).click();
    const row = settings.getByTestId("settings-agent-row-codex");
    await expect(row).toContainText("暂时无法使用");
    await expect(row.locator(".settings-agent-default-badge")).toBeVisible();
    await expect(settings.getByTestId("settings-agent-row-pageroot").locator(".settings-agent-service-main")).toContainText("未检查");
    const repairStyle = await row.getByRole("button", { name: "重新检查", exact: true }).evaluate((button) => ({
      fontSize: getComputedStyle(button).fontSize,
      height: button.getBoundingClientRect().height,
      inset: button.getBoundingClientRect().left - button.closest('[data-testid="settings-agent-row-codex"]').getBoundingClientRect().left,
    }));
    expect(repairStyle.fontSize).toBe("12px");
    expect(repairStyle.height).toBe(34);
    expect(repairStyle.inset).toBeLessThanOrEqual(24);
    await expect(row.locator(".qoder-card-copy small")).toHaveCSS("font-size", "13px");
    await launched.page.screenshot({ path: path.join(screenshots, "settings-codex-authenticated-repair.png"), animations: "disabled" });
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await sidebar.getByTestId("ai-conversation-agent").click();
    await sidebar.getByTestId("ai-conversation-service-codex").click();
    await expect(sidebar.getByTestId("ai-conversation-setup-panel")).toHaveCount(0);
    await expect(settings).toBeVisible();
    const panel = await expandSettingsAgent(settings, "codex");
    await expect(panel).toContainText("账号已登录，但连接检查没有通过。");
    await expect(panel.getByTestId("agent-diagnostic-details")).not.toHaveAttribute("open", "");
    await launched.page.screenshot({ path: path.join(screenshots, "codex-repair-in-settings.png"), animations: "disabled" });
    broken = false;
    await panel.getByRole("button", { name: "重新检查", exact: true }).click();
    await expect(panel).toContainText("已连接");
    expect(installs).toBe(0);
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    await sidebar.getByRole("button", { name: /交给 Codex 修改/u }).click();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    expect(readFileSync(workingPath, "utf8")).not.toContain('data-pageroot-codex-acp="e2e"');
    await sidebar.getByRole("button", { name: "查看修改" }).click();
    await sidebar.getByRole("button", { name: "采用修改", exact: true }).click();
    await expect.poll(async () => (await launched.page.evaluate(() => window.htmlAIProjects.getActiveProject()))?.sourcePath)
      .toMatch(/-V2\.html$/u);
    const first = await launched.page.evaluate(() => window.htmlAIProjects.getActiveProject());
    await loadedDiskFrame(launched.page, first.sourcePath);
    await addComment(launched.page, first.sourcePath, "继续调整标题。");
    if (!await sidebar.isVisible()) await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    await sidebar.getByRole("button", { name: /交给 Codex 修改/u }).click();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await launched.page.screenshot({ path: path.join(screenshots, "codex-second-round.png"), animations: "disabled" });
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("known incompatible Codex offers other AI without reinstalling the same component", async () => {
  const fixture = createSourceFixture("codex-incompatible-component.html");
  const command = createCodexAcpE2ECommand(fixture.sourceDirectory);
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath, injectedEnv: {
    PAGEROOT_CODEX_ACP_ALLOW_TEST_COMMAND: "1", PAGEROOT_CODEX_ACP_COMMAND: command,
  } });
  let installs = 0;
  try {
    await launched.page.route("**/agent/diagnose?*", async (route) => {
      const selection = JSON.parse(new URL(route.request().url()).searchParams.get("selection") || "{}");
      if (selection.providerId !== "codex") return route.continue();
      return route.fulfill({ json: { status: "unavailable", diagnostic: {
        readiness: "connection-failed", cause: "CODEX_EXECUTION_CONTRACT_UNSUPPORTED", operation: "diagnose",
        facts: { installation: "ready", authentication: "ready", protocol: "failed", service: "unknown" },
      } } });
    });
    await launched.page.route("**/agent/install", async (route) => { installs += 1; await route.abort(); });
    await addComment(launched.page, fixture.sourcePath, "调整标题。");
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "codex");
    const row = settings.getByTestId("settings-agent-row-codex");
    await expect(row).toContainText("当前 Codex 组件暂不支持完成修改");
    await expect(row).toContainText("账号已登录。");
    await expect(row.getByRole("button", { name: /更新连接组件|修复连接/u })).toHaveCount(0);
    await launched.page.screenshot({ path: path.join(screenshots, "codex-execution-unsupported-settings.png"), animations: "disabled" });
    await row.getByRole("button", { name: "使用其他 AI", exact: true }).click();
    await expect(row).not.toHaveAttribute("data-expanded", "true");
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await sidebar.getByTestId("ai-conversation-agent").click();
    await sidebar.getByTestId("ai-conversation-service-codex").click();
    await expect(sidebar.getByTestId("ai-conversation-setup-panel")).toHaveCount(0);
    await expect(settings).toBeVisible();
    const panel = await expandSettingsAgent(settings, "codex");
    await expect(panel.getByRole("button", { name: "重新检查", exact: true })).toBeVisible();
    await launched.page.screenshot({ path: path.join(screenshots, "codex-unavailable-settings.png"), animations: "disabled" });
    await panel.getByRole("button", { name: "使用其他 AI", exact: true }).click();
    await expect(settings.getByTestId("settings-agent-row-pageroot")).toHaveAttribute("data-expanded", "true");
    expect(installs).toBe(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
