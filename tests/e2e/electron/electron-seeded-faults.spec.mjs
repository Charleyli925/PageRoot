import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  launchPageRoot,
  loadedDiskFrame,
  mkdirSync,
  mkdtempSync,
  path,
  removeValidatedTemporaryDirectory,
  stopPageRoot,
  tmpdir,
  writeFileSync,
} from "./electron-native-harness.mjs";

const STATIC_PAGE = `<!doctype html>
<html><head><title>Seeded fault canary</title></head><body>
  <main>
    <p data-native-case="seeded-fault">连续编辑时 Active iframe 必须保持可见。</p>
  </main>
</body></html>`;

async function withRuntimeProject(prefix, files, run) {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), prefix));
  const sourcePath = path.join(sourceDirectory, "runtime-report.html");
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(sourceDirectory, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
  }
  const session = {
    electronApp: null,
    page: null,
    isolatedUserData: null,
  };
  try {
    Object.assign(session, await launchPageRoot({
      activeSourcePath: sourcePath,
    }));
    await run({
      get page() {
        return session.page;
      },
      sourcePath,
    });
  } finally {
    if (session.electronApp && session.isolatedUserData) {
      await stopPageRoot(session.electronApp, session.isolatedUserData);
    }
    removeValidatedTemporaryDirectory(sourceDirectory, prefix);
  }
}

async function enableContinuityProbe(page) {
  await expect.poll(() => page.evaluate(() => ({
    editor: Boolean(document.querySelector('[data-testid="html-canvas-editor"]')),
    enable: typeof window.__PAGEROOT_ENABLE_RUNTIME_CONTINUITY__,
  })), { timeout: 30_000 }).toEqual({
    editor: true,
    enable: "function",
  });
  await page.evaluate(() => window.__PAGEROOT_ENABLE_RUNTIME_CONTINUITY__());
}

async function continuitySummary(page) {
  return page.evaluate(() => window.__PAGEROOT_SUMMARIZE_RUNTIME_CONTINUITY__());
}

test("clearing the Active iframe fails the editing canary and restoring it recovers", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  await withRuntimeProject("pageroot-seeded-iframe-e2e-", {
    "runtime-report.html": STATIC_PAGE,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "seeded-fault");
    await activateNativeEdit(frame, "seeded-fault");
    await enableContinuityProbe(page);
    await expect.poll(async () => (await continuitySummary(page)).insufficientSamples).toBe(false);
    expect((await continuitySummary(page)).missingVisibleFrame).toBe(false);

    await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="html-canvas-editor"]');
      const iframe = editor?.querySelector("iframe:not([data-frame-role])");
      if (!iframe?.parentElement) {
        throw new Error("Active iframe is missing before the seeded fault.");
      }
      window.__PAGEROOT_SEEDED_IFRAME__ = {
        iframe,
        parent: iframe.parentElement,
        next: iframe.nextSibling,
      };
      iframe.remove();
    });
    await expect.poll(async () => (await continuitySummary(page)).missingVisibleFrame).toBe(true);

    await page.evaluate(() => {
      const seeded = window.__PAGEROOT_SEEDED_IFRAME__;
      if (!seeded?.iframe || !seeded.parent) {
        throw new Error("Seeded Active iframe cannot be restored.");
      }
      seeded.parent.insertBefore(seeded.iframe, seeded.next);
    });
    await expect.poll(async () => (await continuitySummary(page)).latest?.visibleFrameCount)
      .toBeGreaterThan(0);
  });
});

test("creating a Candidate iframe during edit fails the editing canary and removing it recovers", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  await withRuntimeProject("pageroot-seeded-candidate-e2e-", {
    "runtime-report.html": STATIC_PAGE,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "seeded-fault");
    await activateNativeEdit(frame, "seeded-fault");
    await enableContinuityProbe(page);
    await expect.poll(async () => (await continuitySummary(page)).insufficientSamples).toBe(false);
    expect((await continuitySummary(page)).unexpectedCandidate).toBe(false);

    await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="html-canvas-editor"]');
      const candidate = document.createElement("iframe");
      candidate.setAttribute("data-frame-role", "runtime-candidate");
      candidate.setAttribute("data-seeded-fault", "candidate-created-during-edit");
      editor.append(candidate);
    });
    await expect.poll(async () => (await continuitySummary(page)).unexpectedCandidate).toBe(true);

    await page.evaluate(() => {
      document.querySelector('iframe[data-seeded-fault="candidate-created-during-edit"]')?.remove();
    });
    await expect.poll(async () => (await continuitySummary(page)).latest?.candidatePresent)
      .toBe(false);
  });
});
