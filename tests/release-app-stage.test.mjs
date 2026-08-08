import assert from "node:assert/strict";
import {
  cp,
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

import { parseBuildOptions } from "../scripts/build-package.mjs";
import {
  createReleaseAppCheckpoint,
  createReleaseDryRunCheckpoint,
  releaseAppCheckpointArtifactName,
  releaseDryRunCheckpointArtifactName,
  restoreReleaseAppCheckpoint,
  restoreReleaseDryRunCheckpoint,
  verifyReleaseAppCheckpoint,
  verifyReleaseDryRunCheckpoint,
} from "../scripts/release-app-checkpoint.mjs";
import {
  RELEASE_DRY_RUN_TELEMETRY_HOST,
  RELEASE_DRY_RUN_TELEMETRY_TOKEN,
  candidateAppBuilderArguments,
  candidateAppEnvironment,
  candidateArtifactBuilderArguments,
  candidateArtifactBuilderEnvironment,
  notarizeCandidateApp,
  releaseDryRunAppBuilderArguments,
  releaseDryRunAppEnvironment,
  restoreReleaseMetadataFromApp,
  signCandidateApp,
} from "../scripts/release-app-stage.mjs";
import {
  assertPackagedAppIdentity,
  expectedPackagedAppIdentity,
} from "../scripts/packaged-app-identity.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const packageVersion = "0.9.4";
const builtAt = "2026-07-29T00:00:00.000Z";

function fixturePackageJson() {
  return {
    name: "pageroot",
    version: packageVersion,
    devDependencies: { electron: "43.2.0" },
    build: {
      appId: "com.htmlai.workbench",
      productName: "PageRoot",
      mac: {
        entitlements: "desktop/resources/entitlements.mac.plist",
        entitlementsInherit: "desktop/resources/entitlements.mac.plist",
      },
    },
  };
}

function fixtureIdentity() {
  return {
    commitSha,
    treeSha,
    dirty: false,
    dirtyPaths: [],
    packageVersion,
    lockVersion: packageVersion,
    packageJson: fixturePackageJson(),
  };
}

async function fixtureExpectedBuildInfo() {
  return {
    schemaVersion: 1,
    name: "pageroot",
    version: packageVersion,
    architecture: "arm64",
    sourceRepository: "https://github.com/Charleyli925/PageRoot",
    commitSha,
    treeSha,
  };
}

async function writeCandidateApp(root) {
  const appPath = path.join(
    root,
    "output/release-candidate/staged/mac-arm64/PageRoot.app",
  );
  const resources = path.join(appPath, "Contents/Resources");
  await Promise.all([
    mkdir(path.join(resources, "bridge"), { recursive: true }),
    mkdir(path.join(resources, "schemas"), { recursive: true }),
    mkdir(path.join(resources, "shared"), { recursive: true }),
  ]);
  const buildInfo = {
    schemaVersion: 1,
    name: "pageroot",
    version: packageVersion,
    architecture: "arm64",
    sourceRepository: "https://github.com/Charleyli925/PageRoot",
    commitSha,
    treeSha,
    builtAt,
  };
  await Promise.all([
    writeFile(path.join(resources, "app.asar"), "synthetic asar"),
    writeFile(path.join(resources, "build-info.json"), `${JSON.stringify(buildInfo)}\n`),
    writeFile(
      path.join(resources, "usage-telemetry-config.json"),
      `${JSON.stringify({
        version: 1,
        enabled: true,
        host: "https://us.i.posthog.com",
        projectToken: "phc_syntheticpageroot",
      })}\n`,
    ),
    writeFile(path.join(resources, "bridge/workspace-bridge.mjs"), "export {};\n"),
    writeFile(path.join(resources, "schemas/change.json"), "{}\n"),
    writeFile(path.join(resources, "shared/draft-aggregate.mjs"), "export {};\n"),
    ...[
      "LICENSE",
      "NOTICE",
      "PRIVACY.md",
      "THIRD_PARTY_NOTICES.md",
      "PageRoot 用户声明与免责声明.txt",
    ].map((name) => writeFile(path.join(resources, name), `${name}\n`)),
  ]);
  return appPath;
}

async function writeDryRunApp(root) {
  const candidateApp = await writeCandidateApp(root);
  const dryRunApp = path.join(
    root,
    "output/release-dry-run/staged/mac-arm64/PageRoot.app",
  );
  await cp(candidateApp, dryRunApp, { recursive: true });
  return dryRunApp;
}

test("formal candidate profiles assemble once and package only a verified prepackaged app", () => {
  const staged = "/tmp/pageroot-release-candidate/staged";
  const appPath = `${staged}/mac-arm64/PageRoot.app`;
  const release = "/tmp/pageroot-release";
  assert.deepEqual(
    parseBuildOptions(["--arch", "arm64", "--profile", "candidate-app"]),
    {
      architecture: "arm64",
      prepackagedAppPath: null,
      profile: "candidate-app",
    },
  );
  assert.deepEqual(
    parseBuildOptions([
      "--arch",
      "arm64",
      "--profile",
      "candidate-artifacts",
      "--prepackaged",
      appPath,
    ]),
    {
      architecture: "arm64",
      prepackagedAppPath: appPath,
      profile: "candidate-artifacts",
    },
  );
  assert.deepEqual(candidateAppBuilderArguments({
    architecture: "arm64",
    releaseDirectory: staged,
  }), [
    "--mac",
    "dir",
    "--arm64",
    "--publish",
    "never",
    "--config.forceCodeSigning=false",
    "--config.mac.identity=-",
    "--config.mac.notarize=false",
    "--config.mac.hardenedRuntime=false",
    `--config.directories.output=${staged}`,
  ]);
  assert.deepEqual(candidateArtifactBuilderArguments({
    architecture: "arm64",
    prepackagedAppPath: appPath,
    releaseDirectory: release,
  }), [
    "--mac",
    "dmg",
    "zip",
    "--arm64",
    "--publish",
    "never",
    `--prepackaged=${appPath}`,
    "--config.forceCodeSigning=false",
    "--config.mac.identity=null",
    "--config.mac.notarize=false",
    `--config.directories.output=${release}`,
  ]);
  assert.throws(
    () => parseBuildOptions(["--arch", "arm64", "--profile", "candidate-artifacts"]),
    /requires --prepackaged/u,
  );
});

test("release dry-run profile reuses ad-hoc assembly without producing distributables", () => {
  const releaseDirectory = "/tmp/pageroot-release-dry-run/staged";
  assert.deepEqual(
    parseBuildOptions(["--arch", "arm64", "--profile", "release-dry-run"]),
    {
      architecture: "arm64",
      prepackagedAppPath: null,
      profile: "release-dry-run",
    },
  );
  assert.deepEqual(
    releaseDryRunAppBuilderArguments({
      architecture: "arm64",
      releaseDirectory,
    }),
    candidateAppBuilderArguments({
      architecture: "arm64",
      releaseDirectory,
    }),
  );
  assert.deepEqual(
    releaseDryRunAppBuilderArguments({
      architecture: "arm64",
      releaseDirectory,
    }).slice(0, 5),
    ["--mac", "dir", "--arm64", "--publish", "never"],
  );
});

test("pre-sign assembly keeps public telemetry but cannot see signing or notarization credentials", () => {
  const source = {
    PATH: "/usr/bin",
    CSC_LINK: "certificate",
    CSC_KEY_PASSWORD: "password",
    APPLE_ID: "release@example.com",
    APPLE_APP_SPECIFIC_PASSWORD: "apple-password",
    APPLE_TEAM_ID: "RNK9RB969G",
    GITHUB_TOKEN: "github-token",
    PAGEROOT_POSTHOG_TOKEN: "phc_syntheticpageroot",
    PAGEROOT_POSTHOG_HOST: "https://us.i.posthog.com",
  };
  const preflight = candidateAppEnvironment(source);
  assert.equal(preflight.PAGEROOT_POSTHOG_TOKEN, source.PAGEROOT_POSTHOG_TOKEN);
  assert.equal(preflight.PAGEROOT_REQUIRE_TELEMETRY_CONFIG, "1");
  assert.equal(preflight.PAGEROOT_REQUIRE_NOTARIZATION, "0");
  for (const name of [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
    "GITHUB_TOKEN",
  ]) {
    assert.equal(preflight[name], undefined);
  }
  const finalBuilder = candidateArtifactBuilderEnvironment(source);
  assert.equal(finalBuilder.PAGEROOT_POSTHOG_TOKEN, undefined);
  assert.equal(finalBuilder.PAGEROOT_POSTHOG_HOST, undefined);
  assert.equal(finalBuilder.CSC_LINK, undefined);
  assert.equal(finalBuilder.APPLE_ID, undefined);

  const dryRun = releaseDryRunAppEnvironment(source);
  assert.equal(dryRun.PAGEROOT_POSTHOG_TOKEN, RELEASE_DRY_RUN_TELEMETRY_TOKEN);
  assert.equal(dryRun.PAGEROOT_POSTHOG_HOST, RELEASE_DRY_RUN_TELEMETRY_HOST);
  assert.equal(dryRun.PAGEROOT_REQUIRE_TELEMETRY_CONFIG, "1");
  assert.equal(dryRun.PAGEROOT_REQUIRE_NOTARIZATION, "0");
  for (const name of [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
    "GITHUB_TOKEN",
  ]) {
    assert.equal(dryRun[name], undefined);
  }
});

test("final artifact packaging restores the exact embedded provenance and telemetry bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-restore-metadata-"));
  try {
    const appPath = await writeCandidateApp(root);
    const resources = path.join(appPath, "Contents/Resources");
    const record = await restoreReleaseMetadataFromApp({
      productRoot: root,
      appPath,
      architecture: "arm64",
      expectedBuildInfoResolver: fixtureExpectedBuildInfo,
    });
    assert.equal(record.buildInfo.builtAt, builtAt);
    assert.equal(record.telemetry.enabled, true);
    assert.deepEqual(
      await readFile(path.join(root, "output/release-metadata/build-info.json")),
      await readFile(path.join(resources, "build-info.json")),
    );
    assert.deepEqual(
      await readFile(path.join(root, "output/release-metadata/usage-telemetry-config.json")),
      await readFile(path.join(resources, "usage-telemetry-config.json")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Developer ID signing uses one temporary keychain and the configured entitlements", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-sign-stage-"));
  try {
    const appPath = await writeCandidateApp(root);
    const calls = [];
    let cleanupCount = 0;
    const result = await signCandidateApp({
      productRoot: root,
      appPath,
      packageJson: fixturePackageJson(),
      environment: {
        CSC_LINK: "base64-certificate",
        CSC_KEY_PASSWORD: "certificate-password",
      },
      platform: "darwin",
      dependencies: {
        temporaryDirectory: {
          async cleanup() {
            cleanupCount += 1;
          },
        },
        async createSigningKeychain(options) {
          calls.push(["keychain", options.cscLink, options.cscKeyPassword]);
          return { keychainFile: "/tmp/pageroot.keychain" };
        },
        async resolveIdentity(type, qualifier, keychain) {
          calls.push(["identity", type, qualifier, keychain]);
          return {
            name: "Developer ID Application: PageRoot (RNK9RB969G)",
            hash: "CERT_HASH",
          };
        },
        async signApplication(options) {
          calls.push(["sign", options]);
        },
        async deleteSigningKeychain(keychain) {
          calls.push(["delete", keychain]);
        },
      },
    });
    assert.equal(
      result.identity,
      "Developer ID Application: PageRoot (RNK9RB969G)",
    );
    const signOptions = calls.find(([name]) => name === "sign")[1];
    assert.equal(signOptions.app, appPath);
    assert.equal(
      signOptions.identity,
      "Developer ID Application: PageRoot (RNK9RB969G)",
    );
    assert.equal(signOptions.platform, "darwin");
    assert.equal(signOptions.type, "distribution");
    assert.equal(signOptions.optionsForFile(appPath).hardenedRuntime, true);
    assert.match(signOptions.optionsForFile(appPath).entitlements, /entitlements\.mac\.plist$/u);
    assert.deepEqual(calls.at(-1), ["delete", "/tmp/pageroot.keychain"]);
    assert.equal(cleanupCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("app notarization has no blanket retry and staples only after Apple accepts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-notary-stage-"));
  try {
    const appPath = await writeCandidateApp(root);
    const calls = [];
    await notarizeCandidateApp({
      productRoot: root,
      appPath,
      environment: {
        APPLE_ID: "release@example.com",
        APPLE_APP_SPECIFIC_PASSWORD: "app-password",
        APPLE_TEAM_ID: "RNK9RB969G",
      },
      platform: "darwin",
      dependencies: {
        async notarizeApplication(options) {
          calls.push(["notarize", options]);
        },
        async commandRunner(command, arguments_) {
          calls.push([command, arguments_]);
        },
      },
    });
    assert.equal(calls.filter(([name]) => name === "notarize").length, 1);
    assert.deepEqual(calls.slice(1), [
      ["/usr/bin/xcrun", ["stapler", "staple", appPath]],
      ["/usr/bin/xcrun", ["stapler", "validate", appPath]],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signed-app checkpoint binds source and archive bytes and restores the same payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-checkpoint-stage-"));
  try {
    const appPath = await writeCandidateApp(root);
    const outputDirectory = "output/release-app-checkpoint/bundle";
    const identity = fixtureIdentity();
    const createRunner = async (_command, arguments_) => {
      await writeFile(arguments_.at(-1), "synthetic signed app archive");
    };
    const record = await createReleaseAppCheckpoint({
      productRoot: root,
      appPath,
      architecture: "arm64",
      repository: "Charleyli925/PageRoot",
      sourceGate: {
        workflowRunId: 400,
        treeSha,
        packageVersion,
      },
      workflow: {
        runId: 500,
        runAttempt: 2,
      },
      outputDirectory,
      createdAt: new Date("2026-07-29T01:00:00.000Z"),
      commandRunner: createRunner,
      identity,
    });
    assert.equal(record.attestation.kind, "signed-app-checkpoint");
    assert.equal(record.attestation.publicReleaseEligible, false);
    assert.equal(
      record.attestation.artifactName,
      releaseAppCheckpointArtifactName({
        treeSha,
        packageVersion,
        architecture: "arm64",
        runAttempt: 2,
      }),
    );
    await assert.doesNotReject(() => verifyReleaseAppCheckpoint({
      productRoot: root,
      directory: outputDirectory,
      architecture: "arm64",
      repository: "Charleyli925/PageRoot",
      sourceGateRunId: 400,
      workflowRunId: 500,
      identity,
    }));

    const restored = await restoreReleaseAppCheckpoint({
      productRoot: root,
      directory: outputDirectory,
      outputDirectory: "output/release-candidate/restored",
      architecture: "arm64",
      repository: "Charleyli925/PageRoot",
      sourceGateRunId: 400,
      workflowRunId: 500,
      identity,
      expectedBuildInfoResolver: fixtureExpectedBuildInfo,
      async commandRunner(_command, arguments_) {
        const destination = arguments_.at(-1);
        await cp(appPath, path.join(destination, "PageRoot.app"), { recursive: true });
      },
    });
    assert.equal(restored.appPath, path.join(
      root,
      "output/release-candidate/restored/PageRoot.app",
    ));
    const restoredResources = path.join(restored.appPath, "Contents/Resources");
    assert.deepEqual(
      await readFile(path.join(root, "output/release-metadata/build-info.json")),
      await readFile(path.join(restoredResources, "build-info.json")),
    );
    assert.deepEqual(
      await readFile(path.join(root, "output/release-metadata/usage-telemetry-config.json")),
      await readFile(path.join(restoredResources, "usage-telemetry-config.json")),
    );

    await writeFile(record.archivePath, "tampered archive");
    await assert.rejects(
      () => verifyReleaseAppCheckpoint({
        productRoot: root,
        directory: outputDirectory,
        architecture: "arm64",
        repository: "Charleyli925/PageRoot",
        sourceGateRunId: 400,
        workflowRunId: 500,
        identity,
      }),
      /archive (?:size|bytes) changed/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release dry-run checkpoint is non-release, restores metadata and cannot enter the formal lane", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-dry-run-checkpoint-"));
  try {
    const appPath = await writeDryRunApp(root);
    const outputDirectory = "output/release-dry-run-checkpoint/bundle";
    const identity = fixtureIdentity();
    const record = await createReleaseDryRunCheckpoint({
      productRoot: root,
      appPath,
      architecture: "arm64",
      repository: "Charleyli925/PageRoot",
      workflow: {
        runId: 700,
        runAttempt: 3,
      },
      outputDirectory,
      createdAt: new Date("2026-08-08T01:00:00.000Z"),
      async commandRunner(_command, arguments_) {
        await writeFile(arguments_.at(-1), "synthetic release dry-run archive");
      },
      identity,
    });
    assert.equal(record.attestation.kind, "release-dry-run-checkpoint");
    assert.equal(record.attestation.releaseEligible, false);
    assert.equal(record.attestation.publicReleaseEligible, false);
    assert.equal(
      record.attestation.artifactName,
      releaseDryRunCheckpointArtifactName({
        treeSha,
        packageVersion,
        architecture: "arm64",
        runAttempt: 3,
      }),
    );
    await assert.doesNotReject(() => verifyReleaseDryRunCheckpoint({
      productRoot: root,
      directory: outputDirectory,
      architecture: "arm64",
      repository: "Charleyli925/PageRoot",
      workflowRunId: 700,
      identity,
    }));

    const restored = await restoreReleaseDryRunCheckpoint({
      productRoot: root,
      directory: outputDirectory,
      outputDirectory: "output/release-dry-run/restored",
      architecture: "arm64",
      repository: "Charleyli925/PageRoot",
      workflowRunId: 700,
      identity,
      expectedBuildInfoResolver: fixtureExpectedBuildInfo,
      async commandRunner(_command, arguments_) {
        await cp(appPath, path.join(arguments_.at(-1), "PageRoot.app"), {
          recursive: true,
        });
      },
    });
    assert.equal(
      restored.appPath,
      path.join(root, "output/release-dry-run/restored/PageRoot.app"),
    );
    assert.equal(restored.metadata.telemetry.enabled, true);

    await assert.rejects(
      restoreReleaseDryRunCheckpoint({
        productRoot: root,
        directory: outputDirectory,
        outputDirectory: "output/release-dry-run/missing-telemetry",
        architecture: "arm64",
        repository: "Charleyli925/PageRoot",
        workflowRunId: 700,
        identity,
        expectedBuildInfoResolver: fixtureExpectedBuildInfo,
        async commandRunner(_command, arguments_) {
          const destination = path.join(arguments_.at(-1), "PageRoot.app");
          await cp(appPath, destination, { recursive: true });
          await rm(path.join(
            destination,
            "Contents/Resources/usage-telemetry-config.json",
          ));
        },
      }),
      /usage-telemetry-config\.json/u,
    );

    const renamedFormalDirectory = path.join(
      root,
      "output/release-app-checkpoint/renamed-dry-run",
    );
    await mkdir(renamedFormalDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(renamedFormalDirectory, "signed-app-checkpoint.json"),
        await readFile(record.attestationPath),
      ),
      writeFile(
        path.join(renamedFormalDirectory, "PageRoot-signed-app.zip"),
        "synthetic release dry-run archive",
      ),
    ]);
    await assert.rejects(
      verifyReleaseAppCheckpoint({
        productRoot: root,
        directory: "output/release-app-checkpoint/renamed-dry-run",
        architecture: "arm64",
        repository: "Charleyli925/PageRoot",
        sourceGateRunId: 400,
        workflowRunId: 700,
        identity,
      }),
      /checkpoint kind is invalid/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaged startup identity fails on the #102 runtime-name regression and Bundle ID drift", () => {
  const expected = expectedPackagedAppIdentity({
    packageJson: fixturePackageJson(),
    environment: {},
  });
  assert.throws(
    () => assertPackagedAppIdentity({
      name: "源页",
      version: packageVersion,
      bundleId: "com.htmlai.workbench",
    }, expected),
    /runtime application name does not match build\.productName/u,
  );
  assert.throws(
    () => assertPackagedAppIdentity({
      name: "PageRoot",
      version: packageVersion,
      bundleId: "com.example.changed",
    }, expected),
    /Bundle ID does not match build\.appId/u,
  );
});

test("formal workflow verifies before Apple and resumes final packaging from a signed-app checkpoint", async () => {
  const [workflow, packageText] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/release-candidate.yml"), "utf8"),
    readFile(path.join(productRoot, "package.json"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  assert.equal(packageJson.devDependencies["@electron/notarize"], "2.5.0");
  assert.equal(packageJson.devDependencies["@electron/osx-sign"], "1.3.3");
  assert.match(workflow, /signed-app:[\s\S]+candidate:[\s\S]+needs: signed-app/u);
  assert.match(
    workflow,
    /Assemble and verify the app before release credentials are used[\s\S]+Developer ID sign the already-verified app[\s\S]+Launch and verify the signed app identity before sending bytes to Apple[\s\S]+Notarize and staple the verified signed app/u,
  );
  assert.match(
    workflow,
    /Upload signed-app checkpoint[\s\S]+Download the exact signed-app checkpoint[\s\S]+--profile candidate-artifacts[\s\S]+Verify final DMG/u,
  );
  assert.match(
    workflow,
    /Verify and restore the signed-app checkpoint[\s\S]+Build the renderer oracle for restored payload verification[\s\S]+npm run desktop:renderer[\s\S]+Revalidate the restored signature, notarization and payload[\s\S]+--profile candidate-app-signed[\s\S]+--profile candidate-artifacts/u,
  );
  assert.match(workflow, /compression-level:\s*0/u);
  assert.match(workflow, /retention-days:\s*14/u);
  assert.doesNotMatch(workflow, /gate:artifact-only:auto/u);
  assert.doesNotMatch(workflow, /(?:git tag|gh release create)/u);
});

test("release dry-run workflow crosses two clean jobs without credentials or release authority", async () => {
  const [workflow, candidateWorkflow] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/release-dry-run.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release-candidate.yml"), "utf8"),
  ]);
  assert.match(workflow, /on:\s*\n\s+pull_request:[\s\S]+paths:/u);
  assert.match(workflow, /- desktop\/\*\*/u);
  assert.match(workflow, /- scripts\/release-app-checkpoint\.mjs/u);
  assert.match(workflow, /- scripts\/workspace-bridge\.mjs/u);
  assert.doesNotMatch(workflow, /- app\/\*\*/u);
  assert.match(workflow, /assemble:[\s\S]+restore:[\s\S]+needs: assemble/u);
  assert.equal((workflow.match(/actions\/checkout@/gu) || []).length, 2);
  assert.equal((workflow.match(/- run: npm ci/gu) || []).length, 2);
  assert.match(
    workflow,
    /Build the first clean-job renderer oracle[\s\S]+--profile release-dry-run[\s\S]+Verify app\.asar, Bridge, schemas, resources and metadata[\s\S]+create-dry-run[\s\S]+Upload the non-release dry-run checkpoint/u,
  );
  assert.match(
    workflow,
    /Download the exact dry-run checkpoint[\s\S]+restore-dry-run[\s\S]+Rebuild the renderer oracle in the second clean job[\s\S]+npm run desktop:renderer[\s\S]+Revalidate the restored payload and metadata[\s\S]+Launch and verify product name, version and Bundle ID/u,
  );
  assert.match(workflow, /PAGEROOT_REQUIRE_TELEMETRY_CONFIG:\s*"1"/u);
  assert.doesNotMatch(workflow, /secrets\.|CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_TEAM_ID/u);
  assert.doesNotMatch(
    workflow,
    /node scripts\/(?:release-candidate-provenance|create-release-assets)\.mjs|--profile candidate-artifacts|git tag|gh release create/u,
  );
  assert.doesNotMatch(candidateWorkflow, /release-dry-run|create-dry-run|restore-dry-run/u);
  for (const sharedScript of [
    "scripts/verify-packaged-artifact.mjs",
    "scripts/release-app-checkpoint.mjs",
  ]) {
    assert.ok(workflow.includes(sharedScript));
    assert.ok(candidateWorkflow.includes(sharedScript));
  }
});
