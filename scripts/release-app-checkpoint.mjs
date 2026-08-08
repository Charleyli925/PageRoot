#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  candidateAppPath,
  notarizeCandidateApp,
  releaseDryRunAppPath,
  restoreReleaseMetadataFromApp,
  signCandidateApp,
} from "./release-app-stage.mjs";
import {
  assertBuildInfo,
  readRepositoryIdentity,
} from "./release-provenance.mjs";
import { readPackageVersions } from "./source-gate-provenance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const CHECKPOINT_FILE = "signed-app-checkpoint.json";
const ARCHIVE_FILE = "PageRoot-signed-app.zip";
const DRY_RUN_CHECKPOINT_FILE = "release-dry-run-checkpoint.json";
const DRY_RUN_ARCHIVE_FILE = "PageRoot-release-dry-run-app.zip";
const LEGAL_RESOURCES = [
  "LICENSE",
  "NOTICE",
  "PRIVACY.md",
  "THIRD_PARTY_NOTICES.md",
  "PageRoot 用户声明与免责声明.txt",
];

function assertArchitecture(value) {
  assert.match(value ?? "", /^(?:arm64|x64)$/u, "architecture must be arm64 or x64");
  return value;
}

function assertSha(value, label) {
  assert.match(value ?? "", SHA_PATTERN, `${label} must be a 40-character Git SHA`);
  return value;
}

function assertVersion(value, label) {
  assert.match(value ?? "", VERSION_PATTERN, `${label} must be a semantic version`);
  return value;
}

function assertPositiveInteger(value, label) {
  const parsed = Number(value);
  assert.ok(Number.isSafeInteger(parsed) && parsed > 0, `${label} must be a positive integer`);
  return parsed;
}

function assertRepository(value) {
  assert.match(
    value ?? "",
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    "repository must use owner/name",
  );
  return value;
}

function managedDirectory(root, value, child) {
  const managedRoot = path.resolve(root, "output", child);
  const resolved = path.resolve(root, value);
  const relative = path.relative(managedRoot, resolved);
  assert.ok(
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${child} directory must be a child of output/${child}`,
  );
  return resolved;
}

function managedAppPath(root, value, child) {
  const managedRoot = path.resolve(root, "output", child);
  const resolved = path.resolve(value);
  const relative = path.relative(managedRoot, resolved);
  assert.ok(
    relative !== ""
      && !relative.startsWith("..")
      && !path.isAbsolute(relative)
      && path.extname(resolved) === ".app",
    `checkpoint app must stay under output/${child}`,
  );
  return resolved;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

async function fileEntry(root, filePath) {
  const info = await stat(filePath);
  assert.ok(info.isFile(), `checkpoint payload is not a file: ${filePath}`);
  return Object.freeze({
    path: path.relative(root, filePath).split(path.sep).join("/"),
    size: info.size,
    sha256: await sha256File(filePath),
  });
}

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(root);
  return files.sort();
}

export async function candidatePayloadEntries(appPath) {
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const requiredFiles = [
    path.join(resourcesPath, "app.asar"),
    path.join(resourcesPath, "build-info.json"),
    path.join(resourcesPath, "usage-telemetry-config.json"),
    ...LEGAL_RESOURCES.map((name) => path.join(resourcesPath, name)),
  ];
  for (const directory of ["bridge", "schemas", "shared"]) {
    requiredFiles.push(...await listFiles(path.join(resourcesPath, directory)));
  }
  return await Promise.all(requiredFiles.sort().map((filePath) => fileEntry(appPath, filePath)));
}

async function readLocalIdentity(root = productRoot) {
  const [packageJson, packageLock] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "package-lock.json"), "utf8").then(JSON.parse),
  ]);
  const repository = readRepositoryIdentity(root);
  assert.equal(repository.dirty, false, "release checkpoint requires a clean Git checkout");
  return Object.freeze({
    ...repository,
    ...readPackageVersions(packageJson, packageLock),
    packageJson,
  });
}

export function releaseAppCheckpointArtifactName({
  treeSha,
  packageVersion,
  architecture,
  runAttempt,
}) {
  return [
    "PageRoot-signed-app",
    assertSha(treeSha, "tree SHA"),
    assertVersion(packageVersion, "package version"),
    assertArchitecture(architecture),
    `attempt-${assertPositiveInteger(runAttempt, "run attempt")}`,
  ].join("-");
}

export function releaseDryRunCheckpointArtifactName({
  treeSha,
  packageVersion,
  architecture,
  runAttempt,
}) {
  return [
    "PageRoot-release-dry-run",
    assertSha(treeSha, "tree SHA"),
    assertVersion(packageVersion, "package version"),
    assertArchitecture(architecture),
    `attempt-${assertPositiveInteger(runAttempt, "run attempt")}`,
  ].join("-");
}

async function defaultCommandRunner(command, arguments_) {
  const { spawn } = await import("node:child_process");
  const child = spawn(command, arguments_, { stdio: "inherit" });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${path.basename(command)} ended by ${signal}`));
      else resolve(code ?? 1);
    });
  });
  assert.equal(exitCode, 0, `${path.basename(command)} exited with code ${exitCode}`);
}

async function writeOutputs(destination, values) {
  if (!destination) return;
  const lines = Object.entries(values).map(([key, value]) => (
    `${key}=${String(value).replaceAll("\r", "").replaceAll("\n", "")}`
  ));
  await appendFile(destination, `${lines.join("\n")}\n`, "utf8");
}

export async function createReleaseAppCheckpoint({
  productRoot: root = productRoot,
  appPath,
  architecture,
  repository,
  sourceGate,
  workflow,
  outputDirectory,
  createdAt = new Date(),
  commandRunner = defaultCommandRunner,
  identity: identityOverride,
}) {
  const identity = identityOverride ?? await readLocalIdentity(root);
  assertArchitecture(architecture);
  assertRepository(repository);
  assert.equal(sourceGate.treeSha, identity.treeSha, "source-gate tree does not match checkpoint");
  assert.equal(
    sourceGate.packageVersion,
    identity.packageVersion,
    "source-gate version does not match checkpoint",
  );
  const sourceGateRunId = assertPositiveInteger(sourceGate.workflowRunId, "source-gate run id");
  const workflowRunId = assertPositiveInteger(workflow.runId, "workflow run id");
  const workflowRunAttempt = assertPositiveInteger(workflow.runAttempt, "workflow run attempt");
  const resolvedOutput = managedDirectory(root, outputDirectory, "release-app-checkpoint");
  const resolvedApp = managedAppPath(root, appPath, "release-candidate");
  const buildInfo = assertBuildInfo(
    JSON.parse(await readFile(
      path.join(resolvedApp, "Contents", "Resources", "build-info.json"),
      "utf8",
    )),
    {
      schemaVersion: 1,
      name: identity.packageJson.name,
      version: identity.packageVersion,
      architecture,
      sourceRepository: "https://github.com/Charleyli925/PageRoot",
      commitSha: identity.commitSha,
      treeSha: identity.treeSha,
    },
  );
  const payload = await candidatePayloadEntries(resolvedApp);
  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });
  const archivePath = path.join(resolvedOutput, ARCHIVE_FILE);
  await commandRunner(
    "/usr/bin/ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", resolvedApp, archivePath],
  );
  const archiveInfo = await stat(archivePath);
  assert.ok(archiveInfo.isFile() && archiveInfo.size > 0, "signed app archive was not created");
  const artifactName = releaseAppCheckpointArtifactName({
    treeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    architecture,
    runAttempt: workflowRunAttempt,
  });
  const attestation = Object.freeze({
    schemaVersion: 1,
    kind: "signed-app-checkpoint",
    publicReleaseEligible: false,
    repository,
    architecture,
    commitSha: identity.commitSha,
    treeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    packageLockVersion: identity.lockVersion,
    builtAt: buildInfo.builtAt,
    sourceGate: {
      workflowRunId: sourceGateRunId,
      treeSha: sourceGate.treeSha,
      packageVersion: sourceGate.packageVersion,
    },
    producer: {
      workflowRunId,
      workflowRunAttempt,
    },
    artifactName,
    archive: {
      file: ARCHIVE_FILE,
      size: archiveInfo.size,
      sha256: await sha256File(archivePath),
    },
    payload,
    createdAt: createdAt.toISOString(),
  });
  const attestationPath = path.join(resolvedOutput, CHECKPOINT_FILE);
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  await writeOutputs(workflow.githubOutput, {
    artifact_name: artifactName,
    checkpoint_directory: resolvedOutput,
  });
  return { attestation, attestationPath, archivePath };
}

export async function verifyReleaseAppCheckpoint({
  productRoot: root = productRoot,
  directory,
  architecture,
  repository,
  sourceGateRunId,
  workflowRunId,
  identity: identityOverride,
}) {
  const identity = identityOverride ?? await readLocalIdentity(root);
  const resolvedDirectory = managedDirectory(root, directory, "release-app-checkpoint");
  const attestation = JSON.parse(
    await readFile(path.join(resolvedDirectory, CHECKPOINT_FILE), "utf8"),
  );
  assert.equal(attestation.schemaVersion, 1, "checkpoint schema is unsupported");
  assert.equal(attestation.kind, "signed-app-checkpoint", "checkpoint kind is invalid");
  assert.equal(attestation.publicReleaseEligible, false, "checkpoint cannot be public release");
  assert.equal(attestation.repository, assertRepository(repository), "checkpoint repository changed");
  assert.equal(attestation.architecture, assertArchitecture(architecture), "checkpoint architecture changed");
  assert.equal(attestation.commitSha, identity.commitSha, "checkpoint commit changed");
  assert.equal(attestation.treeSha, identity.treeSha, "checkpoint tree changed");
  assert.equal(attestation.packageVersion, identity.packageVersion, "checkpoint version changed");
  assert.equal(attestation.packageLockVersion, identity.lockVersion, "checkpoint lock version changed");
  assert.equal(
    attestation.sourceGate.workflowRunId,
    assertPositiveInteger(sourceGateRunId, "source-gate run id"),
    "checkpoint source-gate run changed",
  );
  assert.equal(attestation.sourceGate.treeSha, identity.treeSha, "checkpoint source-gate tree changed");
  assert.equal(
    attestation.sourceGate.packageVersion,
    identity.packageVersion,
    "checkpoint source-gate version changed",
  );
  assert.equal(
    attestation.producer.workflowRunId,
    assertPositiveInteger(workflowRunId, "workflow run id"),
    "checkpoint producer run changed",
  );
  assert.equal(
    attestation.artifactName,
    releaseAppCheckpointArtifactName({
      treeSha: identity.treeSha,
      packageVersion: identity.packageVersion,
      architecture,
      runAttempt: attestation.producer.workflowRunAttempt,
    }),
    "checkpoint artifact name changed",
  );
  assert.equal(attestation.archive.file, ARCHIVE_FILE, "checkpoint archive name changed");
  const archivePath = path.join(resolvedDirectory, ARCHIVE_FILE);
  const archiveInfo = await stat(archivePath);
  assert.equal(archiveInfo.size, attestation.archive.size, "checkpoint archive size changed");
  assert.equal(
    await sha256File(archivePath),
    attestation.archive.sha256,
    "checkpoint archive bytes changed",
  );
  return { attestation, archivePath, identity };
}

export async function restoreReleaseAppCheckpoint({
  productRoot: root = productRoot,
  directory,
  outputDirectory,
  architecture,
  repository,
  sourceGateRunId,
  workflowRunId,
  githubOutput,
  commandRunner = defaultCommandRunner,
  identity,
  expectedBuildInfoResolver,
}) {
  const verified = await verifyReleaseAppCheckpoint({
    productRoot: root,
    directory,
    architecture,
    repository,
    sourceGateRunId,
    workflowRunId,
    identity,
  });
  const resolvedOutput = managedDirectory(root, outputDirectory, "release-candidate");
  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });
  await commandRunner(
    "/usr/bin/ditto",
    ["-x", "-k", verified.archivePath, resolvedOutput],
  );
  const appPath = path.join(
    resolvedOutput,
    `${verified.identity.packageJson.build.productName}.app`,
  );
  await access(appPath);
  assert.deepEqual(
    await candidatePayloadEntries(appPath),
    verified.attestation.payload,
    "restored candidate payload changed",
  );
  const metadata = await restoreReleaseMetadataFromApp({
    productRoot: root,
    appPath,
    architecture,
    ...(expectedBuildInfoResolver ? { expectedBuildInfoResolver } : {}),
  });
  await writeOutputs(githubOutput, { app_path: appPath });
  return { ...verified, appPath, metadata };
}

export async function createReleaseDryRunCheckpoint({
  productRoot: root = productRoot,
  appPath,
  architecture,
  repository,
  workflow,
  outputDirectory,
  createdAt = new Date(),
  commandRunner = defaultCommandRunner,
  identity: identityOverride,
}) {
  const identity = identityOverride ?? await readLocalIdentity(root);
  assertArchitecture(architecture);
  assertRepository(repository);
  const workflowRunId = assertPositiveInteger(workflow.runId, "workflow run id");
  const workflowRunAttempt = assertPositiveInteger(workflow.runAttempt, "workflow run attempt");
  const resolvedOutput = managedDirectory(
    root,
    outputDirectory,
    "release-dry-run-checkpoint",
  );
  const resolvedApp = managedAppPath(root, appPath, "release-dry-run");
  const buildInfo = assertBuildInfo(
    JSON.parse(await readFile(
      path.join(resolvedApp, "Contents", "Resources", "build-info.json"),
      "utf8",
    )),
    {
      schemaVersion: 1,
      name: identity.packageJson.name,
      version: identity.packageVersion,
      architecture,
      sourceRepository: "https://github.com/Charleyli925/PageRoot",
      commitSha: identity.commitSha,
      treeSha: identity.treeSha,
    },
  );
  const payload = await candidatePayloadEntries(resolvedApp);
  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });
  const archivePath = path.join(resolvedOutput, DRY_RUN_ARCHIVE_FILE);
  await commandRunner(
    "/usr/bin/ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", resolvedApp, archivePath],
  );
  const archiveInfo = await stat(archivePath);
  assert.ok(
    archiveInfo.isFile() && archiveInfo.size > 0,
    "release dry-run app archive was not created",
  );
  const artifactName = releaseDryRunCheckpointArtifactName({
    treeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    architecture,
    runAttempt: workflowRunAttempt,
  });
  const attestation = Object.freeze({
    schemaVersion: 1,
    kind: "release-dry-run-checkpoint",
    releaseEligible: false,
    publicReleaseEligible: false,
    repository,
    architecture,
    commitSha: identity.commitSha,
    treeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    packageLockVersion: identity.lockVersion,
    builtAt: buildInfo.builtAt,
    producer: {
      workflowRunId,
      workflowRunAttempt,
    },
    artifactName,
    archive: {
      file: DRY_RUN_ARCHIVE_FILE,
      size: archiveInfo.size,
      sha256: await sha256File(archivePath),
    },
    payload,
    createdAt: createdAt.toISOString(),
  });
  const attestationPath = path.join(resolvedOutput, DRY_RUN_CHECKPOINT_FILE);
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  await writeOutputs(workflow.githubOutput, {
    artifact_name: artifactName,
    checkpoint_directory: resolvedOutput,
  });
  return { attestation, attestationPath, archivePath };
}

export async function verifyReleaseDryRunCheckpoint({
  productRoot: root = productRoot,
  directory,
  architecture,
  repository,
  workflowRunId,
  identity: identityOverride,
}) {
  const identity = identityOverride ?? await readLocalIdentity(root);
  const resolvedDirectory = managedDirectory(
    root,
    directory,
    "release-dry-run-checkpoint",
  );
  const attestation = JSON.parse(
    await readFile(path.join(resolvedDirectory, DRY_RUN_CHECKPOINT_FILE), "utf8"),
  );
  assert.equal(attestation.schemaVersion, 1, "release dry-run checkpoint schema is unsupported");
  assert.equal(
    attestation.kind,
    "release-dry-run-checkpoint",
    "release dry-run checkpoint kind is invalid",
  );
  assert.equal(attestation.releaseEligible, false, "release dry-run cannot become release eligible");
  assert.equal(
    attestation.publicReleaseEligible,
    false,
    "release dry-run cannot become a public release",
  );
  assert.equal(
    attestation.repository,
    assertRepository(repository),
    "release dry-run repository changed",
  );
  assert.equal(
    attestation.architecture,
    assertArchitecture(architecture),
    "release dry-run architecture changed",
  );
  assert.equal(attestation.commitSha, identity.commitSha, "release dry-run commit changed");
  assert.equal(attestation.treeSha, identity.treeSha, "release dry-run tree changed");
  assert.equal(
    attestation.packageVersion,
    identity.packageVersion,
    "release dry-run version changed",
  );
  assert.equal(
    attestation.packageLockVersion,
    identity.lockVersion,
    "release dry-run lock version changed",
  );
  assert.equal(
    attestation.producer.workflowRunId,
    assertPositiveInteger(workflowRunId, "workflow run id"),
    "release dry-run producer run changed",
  );
  assert.equal(
    attestation.artifactName,
    releaseDryRunCheckpointArtifactName({
      treeSha: identity.treeSha,
      packageVersion: identity.packageVersion,
      architecture,
      runAttempt: attestation.producer.workflowRunAttempt,
    }),
    "release dry-run artifact name changed",
  );
  assert.equal(
    attestation.archive.file,
    DRY_RUN_ARCHIVE_FILE,
    "release dry-run archive name changed",
  );
  const archivePath = path.join(resolvedDirectory, DRY_RUN_ARCHIVE_FILE);
  const archiveInfo = await stat(archivePath);
  assert.equal(
    archiveInfo.size,
    attestation.archive.size,
    "release dry-run archive size changed",
  );
  assert.equal(
    await sha256File(archivePath),
    attestation.archive.sha256,
    "release dry-run archive bytes changed",
  );
  return { attestation, archivePath, identity };
}

export async function restoreReleaseDryRunCheckpoint({
  productRoot: root = productRoot,
  directory,
  outputDirectory,
  architecture,
  repository,
  workflowRunId,
  githubOutput,
  commandRunner = defaultCommandRunner,
  identity,
  expectedBuildInfoResolver,
}) {
  const verified = await verifyReleaseDryRunCheckpoint({
    productRoot: root,
    directory,
    architecture,
    repository,
    workflowRunId,
    identity,
  });
  const resolvedOutput = managedDirectory(root, outputDirectory, "release-dry-run");
  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });
  await commandRunner(
    "/usr/bin/ditto",
    ["-x", "-k", verified.archivePath, resolvedOutput],
  );
  const appPath = path.join(
    resolvedOutput,
    `${verified.identity.packageJson.build.productName}.app`,
  );
  await access(appPath);
  assert.deepEqual(
    await candidatePayloadEntries(appPath),
    verified.attestation.payload,
    "restored release dry-run payload changed",
  );
  const metadata = await restoreReleaseMetadataFromApp({
    productRoot: root,
    appPath,
    architecture,
    profile: "release-dry-run",
    ...(expectedBuildInfoResolver ? { expectedBuildInfoResolver } : {}),
  });
  await writeOutputs(githubOutput, { app_path: appPath });
  return { ...verified, appPath, metadata };
}

function parseArguments(argv) {
  const options = { command: argv.shift() || "", values: {} };
  while (argv.length > 0) {
    const name = argv.shift();
    assert.match(name ?? "", /^--[a-z-]+$/u, `Unknown argument ${name}`);
    options.values[name.slice(2)] = argv.shift() ?? "";
  }
  return options;
}

async function main() {
  const { command, values } = parseArguments(process.argv.slice(2));
  const architecture = assertArchitecture(values.arch || "arm64");
  const packageJson = JSON.parse(await readFile(path.join(productRoot, "package.json"), "utf8"));
  const stagedApp = candidateAppPath({ productRoot, packageJson, architecture });
  const stagedDryRunApp = releaseDryRunAppPath({
    productRoot,
    packageJson,
    architecture,
  });
  if (command === "sign") {
    await signCandidateApp({
      productRoot,
      appPath: stagedApp,
      packageJson,
    });
    console.log(`Developer ID signed app: ${stagedApp}`);
    return;
  }
  if (command === "notarize") {
    await notarizeCandidateApp({ productRoot, appPath: stagedApp });
    console.log(`Notarized and stapled app: ${stagedApp}`);
    return;
  }
  if (command === "create") {
    const record = await createReleaseAppCheckpoint({
      productRoot,
      appPath: stagedApp,
      architecture,
      repository: values.repository,
      sourceGate: {
        workflowRunId: values["source-gate-run-id"],
        treeSha: values["source-gate-tree"],
        packageVersion: values["source-gate-version"],
      },
      workflow: {
        runId: values["run-id"],
        runAttempt: values["run-attempt"],
        githubOutput: values["github-output"],
      },
      outputDirectory: values.output,
    });
    console.log(`Signed app checkpoint: ${record.attestationPath}`);
    return;
  }
  if (command === "restore") {
    const record = await restoreReleaseAppCheckpoint({
      productRoot,
      directory: values.directory,
      outputDirectory: values.output,
      architecture,
      repository: values.repository,
      sourceGateRunId: values["source-gate-run-id"],
      workflowRunId: values["run-id"],
      githubOutput: values["github-output"],
    });
    console.log(`Restored signed app checkpoint: ${record.appPath}`);
    return;
  }
  if (command === "create-dry-run") {
    const record = await createReleaseDryRunCheckpoint({
      productRoot,
      appPath: stagedDryRunApp,
      architecture,
      repository: values.repository,
      workflow: {
        runId: values["run-id"],
        runAttempt: values["run-attempt"],
        githubOutput: values["github-output"],
      },
      outputDirectory: values.output,
    });
    console.log(`Release dry-run checkpoint: ${record.attestationPath}`);
    return;
  }
  if (command === "restore-dry-run") {
    const record = await restoreReleaseDryRunCheckpoint({
      productRoot,
      directory: values.directory,
      outputDirectory: values.output,
      architecture,
      repository: values.repository,
      workflowRunId: values["run-id"],
      githubOutput: values["github-output"],
    });
    console.log(`Restored release dry-run checkpoint: ${record.appPath}`);
    return;
  }
  throw new Error(
    "Command must be sign, notarize, create, restore, create-dry-run or restore-dry-run.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
