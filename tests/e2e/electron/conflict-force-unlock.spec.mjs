import {
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";

import { expect, test } from "@playwright/test";

import {
  createSourceFixture,
  launchPageRoot,
  removeSourceFixture,
  stopPageRoot,
  waitForProjectReady,
} from "./helpers/pageroot-app-fixture.mjs";

test("conflict banner force-unlock restores an editable project", async () => {
  test.setTimeout(120_000);
  const source = createSourceFixture({ fileName: "conflict-force-unlock.html" });
  const launched = await launchPageRoot({ activeSourcePath: source.sourcePath });
  try {
    await waitForProjectReady(launched.page);
    const externalPath = realpathSync(source.sourcePath);
    let workingCopyPath = "";
    await expect.poll(async () => {
      const active = await launched.page.evaluate(
        () => window.htmlAIProjects?.getActiveProject(),
      );
      workingCopyPath = String(active?.sourcePath || "");
      return workingCopyPath && realpathSync(workingCopyPath) !== externalPath;
    }, { timeout: 20_000 }).toBe(true);

    await expect(launched.page.locator("[data-persist-state]").first())
      .toHaveAttribute("data-persist-state", "idle", { timeout: 20_000 });

    launched.page.once("dialog", (dialog) => dialog.accept());
    writeFileSync(
      workingCopyPath,
      "<!doctype html><html><head><title>external</title></head><body><h1>external</h1></body></html>\n",
      "utf8",
    );

    const banner = launched.page.locator(".source-conflict-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner.locator("strong")).toContainText("源文件在磁盘上被其他程序修改了");
    await expect(banner.getByRole("button", { name: "导出当前编辑" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "重新载入外部文件" })).toBeVisible();
    await banner.getByRole("button", { name: "强制解锁项目" }).click();

    await expect(launched.page.locator("[data-persist-state]").first())
      .toHaveAttribute("data-persist-state", "idle", { timeout: 5_000 });
    await expect(banner).toHaveCount(0);
    expect(readFileSync(workingCopyPath, "utf8")).toContain("external");
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(source.sourceDirectory);
  }
});
