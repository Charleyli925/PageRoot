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
  assert.match(mainProcess, /app\.setActivationPolicy\("accessory"\)/u);
  assert.match(mainProcess, /show:\s*e2eWindowForeground/u);
  assert.match(
    mainProcess,
    /function presentMainWindow\(\)[\s\S]*?e2eWindowRunsInBackground[\s\S]*?return false;/u,
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
