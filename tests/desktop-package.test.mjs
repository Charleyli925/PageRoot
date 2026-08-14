import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import semver from "semver";

const APP_FILE_ALLOWLIST = [
  "desktop/main.mjs",
  "desktop/preload.mjs",
  "desktop/external-file-open.mjs",
  "desktop/project-open-queue.mjs",
  "desktop/project-files.mjs",
  "desktop/source-rename.mjs",
  "desktop/project-path-policy.mjs",
  "desktop/welcome-project-content.mjs",
  "desktop/export-copy.mjs",
  "desktop/open-in-default-browser.mjs",
  "desktop/project-ipc-security.mjs",
  "desktop/bridge-startup.mjs",
  "desktop/bridge-shutdown.mjs",
  "desktop/close-recovery.mjs",
  "desktop/product-contract.mjs",
  "desktop/qoder-handoff.mjs",
  "desktop/product-links.mjs",
  "desktop/application-update.mjs",
  "desktop/usage-telemetry.mjs",
  "desktop/preview-protocol.mjs",
  "desktop/edit-runtime-bootstrap.mjs",
  "desktop/edit-runtime-protocol.mjs",
  "desktop/runtime-visual-capture-owner.mjs",
  "app/domain/edit-runtime-contract.js",
  "app/domain/runtime-visual-contract.js",
  "public/brand-logo.png",
  "dist-desktop/renderer/**/*",
  "package.json",
  "!node_modules/**/*",
];

const BRIDGE_FILES = [
  "workspace-bridge.mjs",
  "finalize-attempt.mjs",
  "lifecycle-core.mjs",
  "user-supplement-core.mjs",
  "record-user-supplement.mjs",
  "html-source-parser.mjs",
  "candidate-assessment.mjs",
  "candidate-assessment-decoder.mjs",
  "scope-validator.mjs",
  "target-identity.mjs",
  "product-contract.mjs",
  "attachment-storage.mjs",
  "draft-aggregate.mjs",
  "draft-service.mjs",
  "draft-command-decoder.mjs",
  "project-context-service.mjs",
  "source-history-service.mjs",
  "source-transaction-service.mjs",
];

const PACKAGED_MODULES = [
  "parse5",
  "entities",
  "electron-updater",
  "builder-util-runtime",
  "fs-extra",
  "js-yaml",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "semver",
  "tiny-typed-emitter",
  "debug",
  "sax",
  "ms",
  "argparse",
  "graceful-fs",
  "jsonfile",
  "universalify",
];

const SHARED_FILES = [
  "draft-aggregate.mjs",
  "direct-edit-compatibility.mjs",
  "source-history.mjs",
];

const SCHEMA_FILES = [
  "annotation-records.v3.schema.json",
  "attempt-outcome.v1.schema.json",
  "candidate-assessment.v1.schema.json",
  "change-request.v3.schema.json",
  "committed-marker.v1.schema.json",
  "completion.v1.schema.json",
  "input-manifest.v1.schema.json",
  "project-state.v3.schema.json",
  "runtime-state.v3.schema.json",
  "scope-report.v1.schema.json",
  "source-history.v1.schema.json",
  "user-supplement.v1.schema.json",
  "version-manifest.v3.schema.json",
  "version-transaction.v1.schema.json",
];

const LEGAL_RESOURCE_FILES = [
  "PageRoot 用户声明与免责声明.txt",
  "LICENSE",
  "PRIVACY.md",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
];

function sorted(values) {
  return [...values].sort();
}

function readPackage(text) {
  return JSON.parse(text);
}

test("desktop package manifest owns the exact application and Bridge resource closure", async () => {
  const [packageText, mainProcess] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
  ]);
  const packageJson = readPackage(packageText);
  assert.deepEqual(sorted(packageJson.build.files), sorted(APP_FILE_ALLOWLIST));

  // Package owner: this source-side import closure catches a new main-process
  // dependency before an artifact exists; the imported module's behavior stays
  // with its own direct test owner.
  const mainLocalImports = [...mainProcess.matchAll(
    /from\s+"\.\/([^"]+)";/gu,
  )].map((match) => "desktop/" + match[1]);
  for (const runtimeModule of mainLocalImports) {
    assert.ok(
      packageJson.build.files.includes(runtimeModule),
      "Electron main-process dependency must be packaged: " + runtimeModule,
    );
  }

  const resourceTargets = packageJson.build.extraResources.map((entry) => entry.to);
  assert.deepEqual(
    sorted(resourceTargets),
    sorted([
      ...BRIDGE_FILES.map((fileName) => "bridge/" + fileName),
      ...SHARED_FILES.map((fileName) => "shared/" + fileName),
      ...PACKAGED_MODULES.map((moduleName) => "node_modules/" + moduleName),
      "schemas",
      "app-update.yml",
      "build-info.json",
      "usage-telemetry-config.json",
      ...LEGAL_RESOURCE_FILES,
    ]),
  );
  const schemaResource = packageJson.build.extraResources.find(
    (entry) => entry.to === "schemas",
  );
  assert.deepEqual(sorted(schemaResource?.filter ?? []), sorted(SCHEMA_FILES));

  for (const retiredFile of [
    "desktop/manual-update.mjs",
    "desktop/legacy-editor.mjs",
    "desktop/edit-runtime-probe-owner.mjs",
  ]) {
    assert.equal(
      packageJson.build.files.includes(retiredFile),
      false,
      retiredFile + " must not re-enter the package allowlist",
    );
  }
});

test("desktop package identity and artifact profile stay fixed", async () => {
  const packageJson = readPackage(await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  assert.equal(packageJson.main, "desktop/main.mjs");
  assert.equal(packageJson.name, "pageroot");
  assert.match(packageJson.description, /源页（PageRoot）— Editable islands/u);
  assert.equal(semver.valid(packageJson.version), packageJson.version);
  assert.equal(packageJson.build.appId, "com.htmlai.workbench");
  assert.equal(packageJson.build.productName, "PageRoot");
  assert.equal(packageJson.build.artifactName, "PageRoot-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.afterPack, "desktop/after-pack.mjs");
  assert.deepEqual(packageJson.build.publish, [
    {
      provider: "github",
      owner: "Charleyli925",
      repo: "PageRoot",
      releaseType: "release",
    },
  ]);
  assert.equal(packageJson.build.forceCodeSigning, true);
  assert.deepEqual(packageJson.build.fileAssociations, [{
    ext: ["html", "htm"],
    name: "HTML Document",
    role: "Editor",
    rank: "Alternate",
  }]);
  assert.equal(packageJson.build.mac.identity, undefined);
  assert.equal(packageJson.build.mac.hardenedRuntime, true);
  assert.equal(packageJson.build.mac.notarize, true);
  assert.equal(
    packageJson.build.mac.entitlements,
    "desktop/resources/entitlements.mac.plist",
  );
  assert.equal(
    packageJson.build.mac.entitlementsInherit,
    "desktop/resources/entitlements.mac.plist",
  );
  assert.deepEqual(packageJson.build.mac.target, ["dmg", "zip"]);
  assert.deepEqual(packageJson.build.publish, [{
    provider: "github",
    owner: "Charleyli925",
    repo: "PageRoot",
    releaseType: "release",
  }]);
  assert.equal(packageJson.dependencies["electron-updater"], "6.8.9");
});

test("package security boundaries retain CSP, entitlements and final plist cleanup", async () => {
  const [rendererHtml, entitlements, afterPack] = await Promise.all([
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/resources/entitlements.mac.plist", import.meta.url), "utf8"),
    readFile(new URL("../desktop/after-pack.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(rendererHtml, /Content-Security-Policy/u);
  assert.match(rendererHtml, /default-src 'none'/u);
  assert.match(rendererHtml, /script-src 'self'/u);
  assert.match(rendererHtml, /style-src 'self' 'unsafe-inline' file: http: https: pageroot-edit-runtime:/u);
  assert.match(rendererHtml, /img-src 'self' file: data: blob: http: https: pageroot-edit-runtime:/u);
  assert.match(rendererHtml, /font-src 'self' file: data: http: https: pageroot-edit-runtime:/u);
  assert.match(rendererHtml, /media-src 'self' file: data: blob: http: https: pageroot-edit-runtime:/u);
  assert.match(rendererHtml, /connect-src http:\/\/127\.0\.0\.1:\*/u);
  assert.match(rendererHtml, /frame-src 'self' data: blob: pageroot-preview: pageroot-edit-runtime:/u);
  assert.match(rendererHtml, /object-src 'none'/u);
  assert.match(rendererHtml, /base-uri 'self' file: pageroot-edit-runtime:/u);
  assert.doesNotMatch(rendererHtml, /frame-ancestors/u);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/u);
  assert.doesNotMatch(entitlements, /disable-library-validation/u);

  // Package owner: afterPack changes the final Info.plist before release
  // verification, so this is the low-cost pre-build oracle for privacy scope.
  assert.match(afterPack, /NSMicrophoneUsageDescription/u);
  assert.match(afterPack, /NSAudioCaptureUsageDescription/u);
  assert.match(afterPack, /Delete/u);
});

test("packaged legal notice and icon remain available as reviewed resources", async () => {
  const [notice, iconInfo] = await Promise.all([
    readFile(new URL("../PageRoot 用户声明与免责声明.txt", import.meta.url), "utf8"),
    stat(new URL("../desktop/resources/icon.icns", import.meta.url)),
  ]);
  assert.match(notice, /AI Agent 生成或修改的内容可能不准确/u);
  assert.match(notice, /只会把交接内容复制到本机剪贴板/u);
  assert.match(notice, /Apache License 2\.0/u);
  assert.ok(iconInfo.size > 100_000);
});
