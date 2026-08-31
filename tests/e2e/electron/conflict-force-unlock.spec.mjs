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

const EXTERNAL_HTML =
  "<!doctype html><html><head><title>external</title></head><body><h1>external</h1></body></html>\n";

async function waitForWorkingCopyPath(page, externalPath) {
  let workingCopyPath = "";
  await expect.poll(async () => {
    const active = await page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    workingCopyPath = String(active?.sourcePath || "");
    return workingCopyPath && realpathSync(workingCopyPath) !== externalPath;
  }, { timeout: 20_000 }).toBe(true);
  return workingCopyPath;
}

test("conflict banner adopts the disk version and restores an editable project", async () => {
  test.setTimeout(120_000);
  const source = createSourceFixture({ fileName: "conflict-force-unlock.html" });
  const launched = await launchPageRoot({ activeSourcePath: source.sourcePath });
  try {
    await waitForProjectReady(launched.page);
    const workingCopyPath = await waitForWorkingCopyPath(
      launched.page,
      realpathSync(source.sourcePath),
    );

    await expect(launched.page.locator("[data-persist-state]").first())
      .toHaveAttribute("data-persist-state", "idle", { timeout: 20_000 });

    launched.page.once("dialog", (dialog) => dialog.accept());
    writeFileSync(workingCopyPath, EXTERNAL_HTML, "utf8");

    const banner = launched.page.locator(".source-conflict-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner.locator("strong")).toContainText("源文件在磁盘上被其他程序修改了");
    await expect(banner.getByRole("button", { name: "导出当前 HTML" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "预览外部版本" })).toBeVisible();
    await banner.getByRole("button", { name: "采用磁盘版本" }).click();

    await expect(launched.page.locator("[data-persist-state]").first())
      .toHaveAttribute("data-persist-state", "idle", { timeout: 5_000 });
    await expect(banner).toHaveCount(0);
    expect(readFileSync(workingCopyPath, "utf8")).toContain("external");
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(source.sourceDirectory);
  }
});

test("reopening an existing working copy still watches external disk writes", async () => {
  test.setTimeout(180_000);
  const source = createSourceFixture({ fileName: "conflict-reopen-watch.html" });
  const first = await launchPageRoot({ activeSourcePath: source.sourcePath });
  let launched = first;
  try {
    await waitForProjectReady(first.page);
    const workingCopyPath = await waitForWorkingCopyPath(
      first.page,
      realpathSync(source.sourcePath),
    );
    await stopPageRoot(first.electronApp, first.isolatedUserData, { cleanup: false });
    launched = await launchPageRoot({
      activeSourcePath: workingCopyPath,
      isolatedUserData: first.isolatedUserData,
    });
    await waitForProjectReady(launched.page);
    await expect(launched.page.locator("[data-persist-state]").first())
      .toHaveAttribute("data-persist-state", "idle", { timeout: 20_000 });
    writeFileSync(workingCopyPath, EXTERNAL_HTML, "utf8");
    await expect(launched.page.locator(".source-conflict-banner"))
      .toBeVisible({ timeout: 5_000 });
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(source.sourceDirectory);
  }
});
