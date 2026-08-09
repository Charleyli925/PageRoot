import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPackage } from "@electron/asar";
import {
  notarizeAndStapleDmg,
  refreshDmgUpdateMetadata,
} from "../scripts/build-package.mjs";
import {
  appBundleSignaturePolicyForProfile,
  assertNoRetiredEditorArtifacts,
  expectedArtifactLayout,
  verifyAppBundle,
} from "../scripts/verify-packaged-artifact.mjs";

const productRoot = fileURLToPath(new URL("../", import.meta.url));
const PACKAGED_MODULES = [
  "argparse",
  "builder-util-runtime",
  "debug",
  "electron-updater",
  "entities",
  "fs-extra",
  "graceful-fs",
  "js-yaml",
  "jsonfile",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "ms",
  "parse5",
  "sax",
  "semver",
  "tiny-typed-emitter",
  "universalify",
];

async function writeFixtureFile(root, relativePath, contents) {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
  return destination;
}

async function createPackagedFixture(t) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "html-ai-package-gate-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixtureProductRoot = path.join(temporaryRoot, "product");
  const packageJson = {
    name: "pageroot",
    version: "0.7.0",
    main: "desktop/main.mjs",
    build: {
      appId: "com.htmlai.workbench",
      productName: "PageRoot",
      artifactName: "PageRoot-${version}-${arch}.${ext}",
      directories: { output: "release" },
      extraResources: [
        {
          from: "schemas",
          to: "schemas",
          filter: [
            "candidate-assessment.v1.schema.json",
            "runtime-state.v3.schema.json",
            "scope-report.v1.schema.json",
            "source-history.v1.schema.json",
            "user-supplement.v1.schema.json",
          ],
        },
        {
          from: "output/release-metadata/build-info.json",
          to: "build-info.json",
        },
        {
          from: "PageRoot 用户声明与免责声明.txt",
          to: "PageRoot 用户声明与免责声明.txt",
        },
        {
          from: "output/release-metadata/usage-telemetry-config.json",
          to: "usage-telemetry-config.json",
        },
        { from: "LICENSE", to: "LICENSE" },
        { from: "NOTICE", to: "NOTICE" },
        { from: "PRIVACY.md", to: "PRIVACY.md" },
        { from: "THIRD_PARTY_NOTICES.md", to: "THIRD_PARTY_NOTICES.md" },
      ],
    },
  };
  await writeFixtureFile(
    fixtureProductRoot,
    "package.json",
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  await writeFixtureFile(
    fixtureProductRoot,
    "package-lock.json",
    `${JSON.stringify({
      name: packageJson.name,
      version: packageJson.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: packageJson.name,
          version: packageJson.version,
        },
      },
    }, null, 2)}\n`,
  );
  for (const relativePath of [
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
    "desktop/edit-visual-capture.mjs",
    "app/domain/runtime-visual-contract.js",
    "public/brand-logo.png",
    "dist-desktop/renderer/index.html",
  ]) {
    await writeFixtureFile(
      fixtureProductRoot,
      relativePath,
      `fixture:${relativePath}\n`,
    );
  }
  for (const fileName of [
    "workspace-bridge.mjs",
    "finalize-attempt.mjs",
    "lifecycle-core.mjs",
    "user-supplement-core.mjs",
    "record-user-supplement.mjs",
    "html-source-parser.mjs",
    "candidate-assessment.mjs",
    "scope-validator.mjs",
    "target-identity.mjs",
    "product-contract.mjs",
    "attachment-storage.mjs",
    "draft-aggregate.mjs",
    "draft-service.mjs",
    "project-context-service.mjs",
    "source-history-service.mjs",
  ]) {
    await writeFixtureFile(
      fixtureProductRoot,
      `scripts/${fileName}`,
      `fixture:scripts/${fileName}\n`,
    );
  }
  for (const moduleName of PACKAGED_MODULES) {
    await writeFixtureFile(
      fixtureProductRoot,
      `node_modules/${moduleName}/package.json`,
      `${JSON.stringify({ name: moduleName, version: "fixture" })}\n`,
    );
    await writeFixtureFile(
      fixtureProductRoot,
      `node_modules/${moduleName}/dist/index.js`,
      `export const fixture = ${JSON.stringify(moduleName)};\n`,
    );
  }
  await writeFixtureFile(fixtureProductRoot, "schemas/runtime-state.v3.schema.json", "{\"type\":\"object\"}\n");
  await writeFixtureFile(fixtureProductRoot, "schemas/candidate-assessment.v1.schema.json", "{\"type\":\"object\"}\n");
  await writeFixtureFile(fixtureProductRoot, "schemas/scope-report.v1.schema.json", "{\"type\":\"object\"}\n");
  await writeFixtureFile(fixtureProductRoot, "schemas/source-history.v1.schema.json", "{\"type\":\"object\"}\n");
  await writeFixtureFile(fixtureProductRoot, "schemas/user-supplement.v1.schema.json", "{\"type\":\"object\"}\n");

  const appPath = path.join(
    fixtureProductRoot,
    "release/mac-arm64/PageRoot.app",
  );
  const resourcesPath = path.join(appPath, "Contents/Resources");
  await mkdir(resourcesPath, { recursive: true });
  for (const fileName of [
    "PageRoot 用户声明与免责声明.txt",
    "LICENSE",
    "NOTICE",
    "PRIVACY.md",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    await writeFixtureFile(fixtureProductRoot, fileName, `fixture:${fileName}\n`);
    await writeFixtureFile(resourcesPath, fileName, `fixture:${fileName}\n`);
  }
  await writeFixtureFile(
    appPath,
    "Contents/Info.plist",
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>0.7.0</string>
  <key>CFBundleVersion</key><string>0.7.0</string>
  <key>CFBundleIdentifier</key><string>com.htmlai.workbench</string>
</dict></plist>\n`,
  );

  const asarSource = path.join(temporaryRoot, "asar-source");
  for (const relativePath of [
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
    "dist-desktop/renderer/index.html",
    "desktop/product-contract.mjs",
    "desktop/qoder-handoff.mjs",
    "desktop/product-links.mjs",
    "desktop/application-update.mjs",
    "desktop/usage-telemetry.mjs",
    "desktop/preview-protocol.mjs",
    "desktop/edit-visual-capture.mjs",
    "app/domain/runtime-visual-contract.js",
    "public/brand-logo.png",
    "package.json",
  ]) {
    const destination = path.join(asarSource, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(fixtureProductRoot, relativePath), destination);
  }
  await createPackage(asarSource, path.join(resourcesPath, "app.asar"));
  for (const fileName of [
    "workspace-bridge.mjs",
    "finalize-attempt.mjs",
    "lifecycle-core.mjs",
    "user-supplement-core.mjs",
    "record-user-supplement.mjs",
    "html-source-parser.mjs",
    "candidate-assessment.mjs",
    "scope-validator.mjs",
    "target-identity.mjs",
    "product-contract.mjs",
    "attachment-storage.mjs",
    "draft-aggregate.mjs",
    "draft-service.mjs",
    "project-context-service.mjs",
    "source-history-service.mjs",
  ]) {
    const destination = path.join(resourcesPath, "bridge", fileName);
    await mkdir(path.dirname(destination), { recursive: true });
    const sourcePath = fileName === "product-contract.mjs"
      ? path.join(fixtureProductRoot, "desktop", fileName)
      : path.join(fixtureProductRoot, "scripts", fileName);
    await copyFile(sourcePath, destination);
  }
  await writeFixtureFile(
    fixtureProductRoot,
    "shared/draft-aggregate.mjs",
    "export const fixtureDraftAggregate = true;\n",
  );
  await copyFile(
    path.join(fixtureProductRoot, "shared/draft-aggregate.mjs"),
    await writeFixtureFile(
      resourcesPath,
      "shared/draft-aggregate.mjs",
      "",
    ),
  );
  await writeFixtureFile(
    fixtureProductRoot,
    "shared/source-history.mjs",
    "export const fixtureSourceHistory = true;\n",
  );
  await copyFile(
    path.join(fixtureProductRoot, "shared/source-history.mjs"),
    await writeFixtureFile(
      resourcesPath,
      "shared/source-history.mjs",
      "",
    ),
  );
  for (const moduleName of PACKAGED_MODULES) {
    for (const relativePath of ["package.json", "dist/index.js"]) {
      const destination = path.join(
        resourcesPath,
        "node_modules",
        moduleName,
        relativePath,
      );
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(
        path.join(
          fixtureProductRoot,
          "node_modules",
          moduleName,
          relativePath,
        ),
        destination,
      );
    }
  }
  for (const fileName of [
    "candidate-assessment.v1.schema.json",
    "runtime-state.v3.schema.json",
    "scope-report.v1.schema.json",
    "source-history.v1.schema.json",
    "user-supplement.v1.schema.json",
  ]) {
    const destination = path.join(resourcesPath, "schemas", fileName);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(fixtureProductRoot, "schemas", fileName), destination);
  }
  await writeFixtureFile(
    resourcesPath,
    "build-info.json",
    `${JSON.stringify({
      schemaVersion: 1,
      name: packageJson.name,
      version: packageJson.version,
      architecture: "arm64",
      sourceRepository: "https://github.com/Charleyli925/PageRoot",
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      builtAt: "2026-07-23T00:00:00.000Z",
    }, null, 2)}\n`,
  );
  const telemetryConfig = `${JSON.stringify({
    version: 1,
    enabled: true,
    host: "https://us.i.posthog.com",
    projectToken: "phc_pagerootsynthetic",
  }, null, 2)}\n`;
  await writeFixtureFile(
    fixtureProductRoot,
    "output/release-metadata/usage-telemetry-config.json",
    telemetryConfig,
  );
  await writeFixtureFile(
    resourcesPath,
    "usage-telemetry-config.json",
    telemetryConfig,
  );

  return { appPath, fixtureProductRoot, packageJson, resourcesPath };
}

test("release commands use one automated artifact lane with full tests and packaged runtime verification", async () => {
  const [packageText, verifier, impactMapText, gateRunner, packageBuilder] = await Promise.all([
    readFile(path.join(productRoot, "package.json"), "utf8"),
    readFile(path.join(productRoot, "scripts/verify-packaged-artifact.mjs"), "utf8"),
    readFile(path.join(productRoot, "tests/test-impact-map.json"), "utf8"),
    readFile(path.join(productRoot, "scripts/test-gate.mjs"), "utf8"),
    readFile(path.join(productRoot, "scripts/build-package.mjs"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const impactMap = JSON.parse(impactMapText);
  assert.equal(
    packageJson.scripts.typecheck,
    "npm run architecture:check && tsc --noEmit",
  );
  assert.equal(packageJson.scripts.verify, "npm run gate:task");
  assert.equal(packageJson.scripts["release:mac"], "npm run gate:artifact:auto");
  assert.equal(packageJson.scripts["release:mac:x64"], "npm run gate:artifact:auto:x64");
  assert.equal(
    packageJson.scripts["gate:artifact-only:auto"],
    "node scripts/test-gate.mjs artifact-only --arch arm64",
  );
  assert.deepEqual(impactMap.lanes.artifact.fullSuites, [
    "typecheck",
    "lint",
    "dependency-audit",
    "node-full",
    "browser-full",
    "electron-full",
    "ai-closed-loop",
    "real-html",
    "package-build",
    "packaged-runtime",
    "packaged-verify",
    "package-delivery-report",
  ]);
  assert.deepEqual(impactMap.lanes["artifact-only"].fullSuites, [
    "package-build",
    "packaged-runtime",
    "packaged-verify",
    "package-delivery-report",
  ]);
  assert.match(gateRunner, /output\/test-runs/);
  assert.match(gateRunner, /changeSetSha256/);
  assert.match(packageJson.scripts["audit:dependencies"], /check-dependency-audit\.mjs/);
  assert.match(gateRunner, /require a clean Git worktree/);
  assert.match(gateRunner, /Clean source changed while the gate was running/);
  assert.match(gateRunner, /requires a trusted source-gate decision from CI/);
  assert.match(gateRunner, /PAGEROOT_SOURCE_GATE_TREE/);
  assert.match(packageJson.scripts["desktop:pack:prepared"], /build-package\.mjs --arch arm64/);
  assert.match(
    packageBuilder,
    /\["--mac", "dmg", "zip", `--\$\{architecture\}`, "--publish", "never"\]/u,
    "electron-builder must never publish before PageRoot verifies the complete release asset set",
  );
  assert.ok(packageJson.build.extraResources.some((entry) => entry.to === "build-info.json"));
  assert.ok(
    packageJson.build.extraResources.some(
      (entry) => entry.to === "usage-telemetry-config.json",
    ),
  );
  assert.match(packageJson.scripts["verify:packaged"], /verify-packaged-artifact\.mjs/);
  assert.match(verifier, /codesign/);
  assert.match(verifier, /hdiutil/);
  assert.match(verifier, /app\.asar/);
  assert.match(verifier, /finalize-attempt\.mjs/);
  assert.match(verifier, /lifecycle-core\.mjs/);
  assert.match(verifier, /html-source-parser\.mjs/);
  assert.match(verifier, /scope-validator\.mjs/);
  assert.match(verifier, /packaged Bridge dependency smoke/);

  const layout = expectedArtifactLayout({ productRoot, packageJson, arch: "arm64" });
  assert.match(layout.appPath, /release\/mac-arm64\/PageRoot\.app$/);
  assert.equal(
    path.basename(layout.dmgPath),
    `PageRoot-${packageJson.version}-arm64.dmg`,
  );
  assert.equal(
    path.basename(layout.zipPath),
    `PageRoot-${packageJson.version}-arm64.zip`,
  );
  assert.equal(
    path.basename(layout.blockmapPath),
    `PageRoot-${packageJson.version}-arm64.zip.blockmap`,
  );
  assert.equal(path.basename(layout.updateInfoPath), "latest-mac.yml");
});

test("app-only profiles keep dry-run unsigned without weakening Candidate signature gates", () => {
  assert.equal(appBundleSignaturePolicyForProfile("release-dry-run"), "none");
  assert.equal(appBundleSignaturePolicyForProfile("candidate-app"), "adhoc");
  assert.equal(
    appBundleSignaturePolicyForProfile("candidate-app-signed"),
    "developer-id",
  );
});

test("release packaging notarizes, staples and validates the final DMG", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-dmg-notarize-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const dmgPath = await writeFixtureFile(
    temporaryRoot,
    "PageRoot-0.9.1-arm64.dmg",
    "final dmg bytes",
  );
  const environment = {
    PAGEROOT_REQUIRE_NOTARIZATION: "1",
    APPLE_ID: "release@example.invalid",
    APPLE_APP_SPECIFIC_PASSWORD: "fixture-password",
    APPLE_TEAM_ID: "TEAM123456",
  };
  const calls = [];
  await notarizeAndStapleDmg({
    dmgPath,
    environment,
    commandRunner: async (command, arguments_, options) => {
      calls.push({ command, arguments_, options });
    },
  });
  assert.deepEqual(
    calls.map(({ command, arguments_ }) => [command, arguments_]),
    [
      [
        "/usr/bin/xcrun",
        [
          "notarytool",
          "submit",
          dmgPath,
          "--apple-id",
          environment.APPLE_ID,
          "--password",
          environment.APPLE_APP_SPECIFIC_PASSWORD,
          "--team-id",
          environment.APPLE_TEAM_ID,
          "--wait",
        ],
      ],
      ["/usr/bin/xcrun", ["stapler", "staple", dmgPath]],
      ["/usr/bin/xcrun", ["stapler", "validate", dmgPath]],
    ],
  );
  assert.ok(calls.every(({ options }) => options.environment === environment));

  await assert.rejects(
    notarizeAndStapleDmg({
      dmgPath,
      environment: { PAGEROOT_REQUIRE_NOTARIZATION: "1" },
      commandRunner: async () => assert.fail("must fail before invoking xcrun"),
    }),
    /DMG notarization credentials are missing/u,
  );
  assert.deepEqual(
    await notarizeAndStapleDmg({
      dmgPath,
      environment: {},
      commandRunner: async () => assert.fail("local unsigned packaging must skip this stage"),
    }),
    { skipped: true },
  );
});

test("DMG stapling refreshes only its final latest-mac metadata entry", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-dmg-metadata-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const dmgPath = await writeFixtureFile(
    temporaryRoot,
    "PageRoot-0.9.1-arm64.dmg",
    "stapled-final-dmg",
  );
  const updateInfoPath = await writeFixtureFile(
    temporaryRoot,
    "latest-mac.yml",
    [
      "version: 0.9.1",
      "files:",
      "  - url: PageRoot-0.9.1-arm64.zip",
      "    sha512: exact-zip-digest",
      "    size: 1234",
      "  - url: PageRoot-0.9.1-arm64.dmg",
      "    sha512: stale-dmg-digest",
      "    size: 42",
      "path: PageRoot-0.9.1-arm64.zip",
      "sha512: exact-zip-digest",
      "",
    ].join("\n"),
  );
  const result = await refreshDmgUpdateMetadata({ dmgPath, updateInfoPath });
  const updated = await readFile(updateInfoPath, "utf8");
  assert.equal(result.updated, true);
  assert.match(updated, new RegExp(`    sha512: ${result.sha512}\\n    size: ${result.size}\\n`, "u"));
  assert.match(updated, /PageRoot-0\.9\.1-arm64\.zip\n    sha512: exact-zip-digest\n    size: 1234/u);
  assert.doesNotMatch(updated, /stale-dmg-digest/u);
});

test("retired editor guard rejects dependencies, bundled code, and legacy editing surfaces", () => {
  for (const contents of [
    "const nativeEditing = true; data-pageroot-runtime-node",
    "replace-editable-island",
    "planEditableIslandPatch()",
    "plainTextFlow",
  ]) {
    assert.doesNotThrow(() => assertNoRetiredEditorArtifacts(
      contents,
      "clean native runtime",
    ));
  }
  for (const [label, contents] of [
    ["source package.json", '{"dependencies":{"lexical":"0.48.0"}}'],
    ["source package-lock.json", '{"packages":{"node_modules/@lexical/history":{}}}'],
    ["renderer bundle", "Minified Lexical error"],
    ["renderer bundle", "new TextFlowSession()"],
    ["renderer bundle", "startTextFlowEditing()"],
    ["source package.json", '{"dependencies":{"text-flow":"1.0.0"}}'],
    ["source package-lock.json", '{"packages":{"node_modules/textflow":{}}}'],
    ["source package alias", '{"dependencies":{"legacy-editor":"npm:text-flow@1.0.0"}}'],
    ["app.asar renderer", "<pageroot-text-editor>"],
    ["app.asar renderer", "data-html-canvas-text-flow"],
  ]) {
    assert.throws(
      () => assertNoRetiredEditorArtifacts(contents, label),
      /still contains retired/u,
      label,
    );
  }
});

test("source package manifest and lock contain no retired editor dependency closure", async () => {
  const [manifest, lock] = await Promise.all([
    readFile(path.join(productRoot, "package.json"), "utf8"),
    readFile(path.join(productRoot, "package-lock.json"), "utf8"),
  ]);
  assertNoRetiredEditorArtifacts(manifest, "source package.json");
  assertNoRetiredEditorArtifacts(lock, "source package-lock.json");
});

test("the app-bundle gate compares app.asar, Bridge scripts, schemas and plist version", async (t) => {
  const fixture = await createPackagedFixture(t);
  const result = await verifyAppBundle({
    productRoot: fixture.fixtureProductRoot,
    appPath: fixture.appPath,
    packageJson: fixture.packageJson,
    verifySignature: false,
  });
  assert.equal(result.version, "0.7.0");
  assert.equal(result.asarFileCount, 25);
  assert.equal(result.schemaFileCount, 5);
  assert.equal(result.legalResourceCount, 5);
  assert.equal(result.telemetry.enabled, true);
  assert.equal(result.provenance.commitSha, "a".repeat(40));

  await writeFile(
    path.join(fixture.resourcesPath, "bridge/lifecycle-core.mjs"),
    "stale packaged lifecycle core\n",
  );
  await assert.rejects(
    verifyAppBundle({
      productRoot: fixture.fixtureProductRoot,
      appPath: fixture.appPath,
      packageJson: fixture.packageJson,
      verifySignature: false,
    }),
    /bridge\/lifecycle-core\.mjs does not match source/,
  );
  await copyFile(
    path.join(fixture.fixtureProductRoot, "scripts/lifecycle-core.mjs"),
    path.join(fixture.resourcesPath, "bridge/lifecycle-core.mjs"),
  );

  await writeFile(
    path.join(fixture.resourcesPath, "build-info.json"),
    `${JSON.stringify({
      ...result.provenance,
      version: "9.9.9",
    })}\n`,
  );
  await assert.rejects(
    verifyAppBundle({
      productRoot: fixture.fixtureProductRoot,
      appPath: fixture.appPath,
      packageJson: fixture.packageJson,
      verifySignature: false,
    }),
    /build provenance mismatch for version/,
  );
});

test("restored app verification fails when the fresh renderer oracle is missing (#73)", async (t) => {
  const fixture = await createPackagedFixture(t);
  await rm(path.join(fixture.fixtureProductRoot, "dist-desktop"), {
    recursive: true,
    force: true,
  });
  await assert.rejects(
    verifyAppBundle({
      productRoot: fixture.fixtureProductRoot,
      appPath: fixture.appPath,
      packageJson: fixture.packageJson,
      verifySignature: false,
    }),
    /dist-desktop/u,
  );
});

test("restored app verification fails when telemetry metadata is missing (#74)", async (t) => {
  const fixture = await createPackagedFixture(t);
  await rm(path.join(
    fixture.fixtureProductRoot,
    "output/release-metadata/usage-telemetry-config.json",
  ));
  await assert.rejects(
    verifyAppBundle({
      productRoot: fixture.fixtureProductRoot,
      appPath: fixture.appPath,
      packageJson: fixture.packageJson,
      verifySignature: false,
    }),
    /usage-telemetry-config\.json/u,
  );
});
