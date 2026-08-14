import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath) => new URL(relativePath, import.meta.url);

test("Electron automation stays backgrounded unless foreground debugging is explicit", async () => {
  const [
    mainProcess,
    appFixture,
    nativeSuite,
    aiSuite,
    preflightSuite,
    preflightMain,
  ] = await Promise.all([
    readFile(sourceUrl("../desktop/main.mjs"), "utf8"),
    readFile(sourceUrl("./e2e/electron/helpers/pageroot-app-fixture.mjs"), "utf8"),
    readFile(sourceUrl("./e2e/electron/native-dom-electron.spec.mjs"), "utf8"),
    readFile(sourceUrl("./e2e/electron/ai-handoff-closed-loop.spec.mjs"), "utf8"),
    readFile(sourceUrl("./e2e/electron/ci-environment-preflight.spec.mjs"), "utf8"),
    readFile(sourceUrl("./e2e/electron/fixtures/ci-preflight-main.mjs"), "utf8"),
  ]);

  assert.match(mainProcess, /PAGEROOT_E2E_FOREGROUND === "1"/u);
  // 后台 E2E 不再使用 accessory 激活策略彻底隐藏应用：Dock 图标保留，
  // 窗口仍默认不显示，只有用户主动点击 Dock 图标才调到前台。
  assert.doesNotMatch(mainProcess, /setActivationPolicy\("accessory"\)/u);
  assert.match(mainProcess, /app\.on\("activate"/u);
  assert.match(mainProcess, /presentMainWindow\(\{ userInitiated: true \}\)/u);
  assert.match(mainProcess, /show:\s*e2eWindowForeground/u);
  assert.match(
    mainProcess,
    /function presentMainWindow\(\{ userInitiated = false \} = \{\}\)[\s\S]*?e2eWindowRunsInBackground[\s\S]*?return false;/u,
  );
  // 后台模式自动触发的原生弹窗必须走日志拦截，不能弹在屏幕中央。
  assert.match(
    mainProcess,
    /if \(e2eWindowRunsInBackground\) \{[\s\S]*?reportSuppressedNativeDialog\([\s\S]*?\} else \{[\s\S]*?dialog\.showErrorBox\(/u,
  );

  assert.match(appFixture, /window\.isVisible\(\)/u);
  assert.match(appFixture, /PAGEROOT_E2E_FOREGROUND/u);
  assert.doesNotMatch(appFixture, /page\.bringToFront\(\)/u);
  assert.doesNotMatch(appFixture, /app\.focus\(\{\s*steal:\s*true\s*\}\)/u);
  assert.doesNotMatch(appFixture, /window\?\.show\(\)/u);
  assert.doesNotMatch(appFixture, /window\?\.focus\(\)/u);

  for (const productSuite of [nativeSuite, aiSuite]) {
    assert.match(productSuite, /\.\/helpers\/pageroot-app-fixture\.mjs/u);
    assert.doesNotMatch(productSuite, /page\.bringToFront\(\)/u);
    assert.doesNotMatch(productSuite, /app\.focus\(\{\s*steal:\s*true\s*\}\)/u);
    assert.doesNotMatch(productSuite, /window\?\.show\(\)/u);
    assert.doesNotMatch(productSuite, /window\?\.focus\(\)/u);
  }

  for (const preflightSource of [preflightSuite, preflightMain]) {
    assert.match(preflightSource, /showInactive\(\)/u);
    assert.doesNotMatch(preflightSource, /bringToFront\(\)/u);
    assert.doesNotMatch(preflightSource, /app\.focus\(/u);
    assert.doesNotMatch(preflightSource, /\.focus\(\)/u);
  }
});
