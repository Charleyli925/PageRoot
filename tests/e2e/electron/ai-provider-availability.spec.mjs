import { expect, test } from "@playwright/test";
import {
  QODER_VISUAL_OUTPUT,
  addComment,
  candidateHtmlFiles,
  chooseModifyIntent,
  closeQoderAvailability,
  createCodexAppServerE2ECommand,
  createQoderAcpE2ECommand,
  createSourceFixture,
  existsSync,
  launchPageRoot,
  managedProjectRoots,
  mkdirSync,
  openQoderAvailability,
  path,
  productRoot,
  readFileSync,
  realpathSync,
  readdirSync,
  removeSourceFixture,
  stopPageRoot,
} from "./ai-closed-loop-helpers.mjs";

const AI_ASSISTANT_VISUAL_OUTPUT = path.join(
  productRoot,
  "output/design-qa/ai-assistant-redesign",
);
mkdirSync(AI_ASSISTANT_VISUAL_OUTPUT, { recursive: true });

test("Qoder ACP Agent Bridge streams public execution text without clipboard or automatic adoption", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("qoder-acp-agent-bridge.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    visibleText: true,
    visibleTextGateMs: 700,
  });
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      PAGEROOT_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    const clipboardSentinel = "PAGEROOT_QODER_ACP_MUST_NOT_COPY";
    await launched.electronApp.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      clipboardSentinel,
    );
    await launched.electronApp.evaluate(({ clipboard }) => {
      const originalWriteText = clipboard.writeText.bind(clipboard);
      globalThis.__pageRootE2EClipboardWrites = [];
      clipboard.writeText = (value, type) => {
        globalThis.__pageRootE2EClipboardWrites.push({ value, type: type || null });
        return originalWriteText(value, type);
      };
    });
    const workingCopyPath = await addComment(
      launched.page,
      fixture.sourcePath,
      "请完成 Qoder ACP 自动闭环，但不要直接覆盖当前 HTML。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    // Destination and the local-Agent action live in one compact Composer row.
    const deliveryDialog = await chooseModifyIntent(launched.page);
    await expect(deliveryDialog.getByTestId("ai-conversation-agent"))
      .toContainText("Qoder");
    await expect(deliveryDialog.getByTestId("ai-conversation-context-summary"))
      .toContainText("1 条评论 · 当前 HTML · 项目规则");
    await expect(deliveryDialog.getByText("AGENT BRIDGE", { exact: true })).toHaveCount(0);
    await expect(deliveryDialog.getByText("可信本机 Agent 提示", { exact: true }))
      .toHaveCount(0);
    await deliveryDialog.getByRole("button", { name: /交给 Qoder 修改/u }).click();

    const narration = launched.page.getByTestId("ai-conversation-narration-message");
    await expect(narration).toBeVisible({ timeout: 60_000 });
    await expect(narration).toHaveCount(1);
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toBeVisible();
    await expect(narration).toContainText("正在读取冻结任务。");
    await expect(narration).not.toContainText("正在等待校验。");
    await expect(narration).toContainText(
      "正在读取冻结任务。正在写入 Candidate。正在等待校验。",
      { timeout: 60_000 },
    );
    await expect(narration.getByTestId("ai-conversation-narration").locator("p"))
      .toHaveCount(3);
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toBeVisible();
    await expect.poll(() => launched.page.getByTestId("ai-conversation-stream").evaluate(
      (stream) => Math.round(stream.scrollHeight - stream.clientHeight - stream.scrollTop),
    )).toBeLessThanOrEqual(1);
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "qoder-processing-thinking.png"),
      fullPage: false,
      animations: "disabled",
    });
    await expect(narration.getByRole("button", { name: "复制" })).toBeVisible();
    await expect(narration).not.toContainText("Build PageRoot Candidate");
    await expect(launched.page.getByTestId("ai-conversation-run-summary"))
      .toContainText("已将“qoder-acp-agent-bridge-V1.html”交给 Qoder");
    await expect(launched.page.getByTestId("ai-conversation-run-summary"))
      .toContainText("发送了1 条评论、当前 HTML 和项目规则");

    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 60_000 });
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toHaveCount(0);
    await expect.poll(() => launched.page.getByTestId("ai-conversation-stream").evaluate(
      (stream) => Math.round(stream.scrollHeight - stream.clientHeight - stream.scrollTop),
    )).toBeLessThanOrEqual(1);
    const readyGeometry = await launched.page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="ai-conversation-sidebar"]');
      const composer = document.querySelector('[data-testid="ai-conversation-composer"]');
      const selector = document.querySelector('[data-testid="ai-conversation-agent"]');
      const actions = document.querySelector('[data-testid="ai-conversation-copy-task"]')
        ?.parentElement;
      const bounds = (element) => element?.getBoundingClientRect() || null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentOverflowX: document.documentElement.scrollWidth
          > document.documentElement.clientWidth,
        sidebar: bounds(sidebar),
        composer: bounds(composer),
        selector: bounds(selector),
        actions: bounds(actions),
      };
    });
    expect(readyGeometry.documentOverflowX).toBe(false);
    expect(readyGeometry.sidebar.right).toBeLessThanOrEqual(readyGeometry.viewport.width);
    expect(readyGeometry.composer.bottom).toBeLessThanOrEqual(readyGeometry.viewport.height);
    if (readyGeometry.actions) {
      const selectorCenter = readyGeometry.selector.top + readyGeometry.selector.height / 2;
      const actionsCenter = readyGeometry.actions.top + readyGeometry.actions.height / 2;
      expect(Math.abs(selectorCenter - actionsCenter)).toBeLessThanOrEqual(1);
    }
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "qoder-result-ready.png"),
      fullPage: false,
      animations: "disabled",
    });
    // Observe PageRoot's Electron clipboard API directly instead of reading the
    // shared system clipboard, which another desktop app may legitimately change.
    expect(await launched.electronApp.evaluate(
      () => globalThis.__pageRootE2EClipboardWrites,
    )).toEqual([]);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain(
      "data-pageroot-qoder-acp",
    );

    const projectRoot = managedProjectRoots(launched.workspace).find(
      (root) => realpathSync(workingCopyPath).startsWith(
        `${realpathSync(root)}${path.sep}`,
      ),
    );
    expect(projectRoot).toBeTruthy();
    const projectRecord = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "project.json"),
      "utf8",
    ));
    const candidates = candidateHtmlFiles(
      launched.workspace,
      projectRecord.projectId,
    );
    expect(candidates).toHaveLength(1);
    expect(readFileSync(candidates[0], "utf8"))
      .toContain('data-pageroot-qoder-acp="e2e"');

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain(
      "data-pageroot-qoder-acp",
    );
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Codex App Server shares the public execution stream and retains its frozen identity", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("codex-app-server-agent-bridge.html");
  const codexCommand = createCodexAppServerE2ECommand(fixture.sourceDirectory);
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory);
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      PAGEROOT_QODER_ACP_COMMAND: qoderCommand,
      PAGEROOT_E2E_CODEX_APP_SERVER_ALLOW_TEST_COMMAND: "1",
      PAGEROOT_E2E_CODEX_APP_SERVER_COMMAND: codexCommand,
      PAGEROOT_E2E_CODEX_STREAM_GATE_MS: "700",
    },
  });
  try {
    const workingCopyPath = await addComment(
      launched.page,
      fixture.sourcePath,
      "请完成 Codex App Server 自动闭环，但不要直接覆盖当前 HTML。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const sidebar = await chooseModifyIntent(launched.page);
    await expect(sidebar.getByTestId("ai-conversation-agent"))
      .toHaveAttribute("aria-expanded", "false", { timeout: 60_000 });
    await sidebar.getByTestId("ai-conversation-agent").click();
    const agentChoices = sidebar.getByTestId("ai-conversation-agent-choices");
    await expect(agentChoices).toBeVisible();
    await expect(agentChoices).toContainText("Codex");
    await expect(agentChoices).not.toContainText("本机文件");
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "agent-selector-open.png"),
      fullPage: false,
      animations: "disabled",
    });
    await sidebar.getByTestId("ai-conversation-mode").click();
    await expect(agentChoices).toHaveCount(0);
    await sidebar.getByTestId("ai-conversation-agent").click();
    await launched.page.keyboard.press("Tab");
    await expect(agentChoices.getByRole("button", { name: "Qoder" })).toBeFocused();
    await launched.page.keyboard.press("Escape");
    await expect(agentChoices).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-agent")).toBeFocused();
    await sidebar.getByTestId("ai-conversation-agent").click();
    await agentChoices.getByRole("button", { name: /Codex/u }).click();
    await expect(sidebar.getByTestId("ai-conversation-agent"))
      .toContainText("Codex", { timeout: 60_000 });
    await expect(sidebar.getByTestId("ai-conversation-agent")).toBeFocused();
    await expect(sidebar.getByRole("button", { name: /交给 Codex 修改/u }))
      .toBeEnabled({ timeout: 60_000 });
    await sidebar.getByRole("button", { name: /交给 Codex 修改/u }).click();

    const narration = launched.page.getByTestId("ai-conversation-narration-message");
    await expect(narration).toBeVisible({ timeout: 60_000 });
    await expect(narration).toHaveCount(1);
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toBeVisible();
    await expect(narration).toContainText("先读取冻结任务。");
    await expect(narration).not.toContainText("最后等待校验。");
    await expect(narration).toContainText("Codex", { timeout: 10_000 });
    await expect(narration.locator("img")).toHaveCount(0);
    await expect(narration).not.toContainText("这段推理不能进入 Stemmio 侧栏。");

    // Switching the idle selection cannot rename or redirect the Request already running.
    await sidebar.getByTestId("ai-conversation-agent").click();
    await sidebar.getByRole("button", { name: "Qoder" }).click();
    await expect(narration).toContainText("Codex");
    await expect(narration).toContainText(
      "先读取冻结任务。再写入 Candidate。最后等待校验。",
      { timeout: 60_000 },
    );
    await expect(narration.getByTestId("ai-conversation-narration").locator("p"))
      .toHaveCount(2);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 60_000 });
    const decisionAnnouncement = launched.page
      .getByTestId("ai-conversation-action-bar")
      .getByRole("status");
    await expect(decisionAnnouncement).toHaveText(/版本 2 等待你的决定/u);
    await expect(decisionAnnouncement).toHaveAttribute("aria-live", "polite");
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toHaveCount(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain(
      "data-pageroot-codex-app-server",
    );

    const projectRoot = managedProjectRoots(launched.workspace).find(
      (root) => realpathSync(workingCopyPath).startsWith(
        `${realpathSync(root)}${path.sep}`,
      ),
    );
    expect(projectRoot).toBeTruthy();
    const projectRecord = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "project.json"),
      "utf8",
    ));
    const candidates = candidateHtmlFiles(
      launched.workspace,
      projectRecord.projectId,
    );
    expect(candidates).toHaveLength(1);
    expect(readFileSync(candidates[0], "utf8"))
      .toContain('data-pageroot-codex-app-server="e2e"');

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Qoder login entry opens About without restoring a Discussion composer", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-auth-required.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    authRequired: true,
  });
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      PAGEROOT_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    let requestPosts = 0;
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/request") requestPosts += 1;
    });
    await addComment(
      launched.page,
      fixture.sourcePath,
      "验证 Qoder 登录引导不会创建本轮任务。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-intent")).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "登录 Qoder CLI" }))
      .toBeVisible();
    await launched.page.screenshot({
      path: path.join(QODER_VISUAL_OUTPUT, "real-sidebar-login.png"),
      fullPage: false,
    });
    await sidebar.getByRole("button", { name: "登录 Qoder CLI" }).click();

    const about = launched.page.getByRole("dialog", { name: "源页" });
    await expect(about).toBeVisible();
    await expect(about.getByRole("heading", { name: "AI Agent" })).toBeVisible();
    await expect(about.getByText("Qoder CLI", { exact: true })).toBeVisible();
    await expect(about.getByText("需要登录", { exact: true })).toBeVisible();
    await expect(about.getByRole("button", { name: "复制指令粘贴至 Agent" }))
      .toBeVisible();
    await about.screenshot({
      path: path.join(QODER_VISUAL_OUTPUT, "real-about-login.png"),
      animations: "disabled",
    });
    expect(requestPosts).toBe(0);
    await about.getByRole("button", { name: "复制指令粘贴至 Agent" }).click();
    await expect(about.getByText("等待登录", { exact: true })).toBeVisible();
    await expect(about.getByRole("button", { name: "重新复制" })).toBeVisible();
    await about.screenshot({
      path: path.join(QODER_VISUAL_OUTPUT, "real-about-waiting-login.png"),
      animations: "disabled",
    });
    expect(await launched.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain("qodercli login");
    expect(requestPosts).toBe(0);

    await closeQoderAvailability(launched.page);
    await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
    await openQoderAvailability(launched.page);
    await expect(about.getByText("等待登录", { exact: true })).toBeVisible();
    expect(requestPosts).toBe(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Qoder installed while PageRoot is open refreshes in place and continues once", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-installed-while-open.html");
  const qoderCommand = path.join(fixture.sourceDirectory, "pageroot-qoder-acp-e2e");
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      PAGEROOT_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    let requestPosts = 0;
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/request") requestPosts += 1;
    });
    await addComment(
      launched.page,
      fixture.sourcePath,
      "验证 PageRoot 打开期间安装 Qoder CLI 后可原地继续。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const deliveryDialog = await openQoderAvailability(launched.page);
    await expect(deliveryDialog.getByText("未安装", { exact: true })).toBeVisible();
    await expect(deliveryDialog.getByRole("button", { name: "安装 Qoder CLI" })).toBeVisible();
    expect(requestPosts).toBe(0);

    createQoderAcpE2ECommand(fixture.sourceDirectory);
    await launched.page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(deliveryDialog.getByText("已连接", { exact: true })).toBeVisible();
    // The About card only observes availability; continuing the round is the
    // conversation's own send action.
    expect(requestPosts).toBe(0);

    await closeQoderAvailability(launched.page);
    await chooseModifyIntent(launched.page);
    await launched.page.getByRole("button", { name: "交给 Qoder 修改" }).click();
    await expect.poll(() => requestPosts).toBe(1);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Qoder capacity exhaustion stays unavailable without recovery buttons or a Request", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-capacity-unavailable.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    capacityUnavailable: true,
  });
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      PAGEROOT_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    let requestPosts = 0;
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/request") requestPosts += 1;
    });
    await addComment(
      launched.page,
      fixture.sourcePath,
      "额度不足时仍然不应创建本轮任务。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const aboutSection = await openQoderAvailability(launched.page);
    await expect(
      aboutSection.getByText("暂不可用 · Qoder 额度已用完", { exact: true }),
    ).toBeVisible();
    await expect(aboutSection.getByRole("button", { name: /检测|重新/u })).toHaveCount(0);
    expect(requestPosts).toBe(0);
    await launched.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      aboutSection.getByText("暂不可用 · Qoder 额度已用完", { exact: true }),
    ).toBeVisible();
    expect(requestPosts).toBe(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Qoder ACP polling waits for start and a managed stop kills the Agent", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-acp-managed-stop.html");
  const pidFile = path.join(fixture.sourceDirectory, "qoder-acp.pid");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    hang: true,
    pidFile,
  });
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      PAGEROOT_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    const bridgeTraffic = [];
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.hostname === "127.0.0.1"
        && ["/agent/start", "/status"].includes(url.pathname)
      ) bridgeTraffic.push(`${request.method()} ${url.pathname}`);
    });
    const workingCopyPath = await addComment(
      launched.page,
      fixture.sourcePath,
      "保持 ACP 会话运行，直到我在源页停止本轮。",
    );
    const workingBefore = readFileSync(workingCopyPath);
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    // The round is started from the conversation itself; the About card only
    // observes availability and never launches the Agent.
    await chooseModifyIntent(launched.page);
    await launched.page.getByRole("button", { name: "交给 Qoder 修改" }).click();

    const stopButton = launched.page.getByRole("button", { name: "结束本轮" });
    await expect(stopButton).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(Number.isSafeInteger(pid)).toBe(true);
    await launched.page.waitForTimeout(750);
    const falseFailureToast = launched.page.locator(".toast.show").filter({
      hasText: "Qoder CLI 没有完成本轮",
    });
    expect(
      await falseFailureToast.count(),
      `Bridge request order: ${bridgeTraffic.join(", ")}`,
    ).toBe(0);

    await stopButton.click();
    await expect(launched.page.locator('aside[aria-label="本轮评论"]')
      .getByRole("button", { name: "全局评论", exact: true }))
      .toBeEnabled({ timeout: 45_000 });
    await expect.poll(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        throw error;
      }
    }).toBe(false);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);
    expect(readFileSync(workingCopyPath)).toEqual(workingBefore);
    expect(candidateHtmlFiles(launched.workspace, (
      JSON.parse(readFileSync(
        path.join(managedProjectRoots(launched.workspace)[0], ".pageroot", "project.json"),
        "utf8",
      )).projectId
    ))).toHaveLength(0);
    const requestsRoot = path.join(
      managedProjectRoots(launched.workspace)[0],
      ".pageroot",
      "requests",
    );
    const requestDirectory = readdirSync(requestsRoot).find((name) => !name.startsWith("."));
    const request = JSON.parse(readFileSync(
      path.join(requestsRoot, requestDirectory, "request.json"),
      "utf8",
    ));
    expect(request.status).toBe("cancelled");
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
