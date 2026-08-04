import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertFullyAutomatedPlan,
  normalizeRepositoryPath,
  selectGatePlan,
  validateImpactMap,
} from "./test-gate-core.mjs";
import {
  DEVELOPER_PREVIEW_ARTIFACT_PATTERN,
  developerPreviewPackageJson,
  developerPreviewReleaseDirectory,
  resolveDeveloperPreviewIdentity,
  writeDeveloperPreviewAttestation,
} from "./developer-preview.mjs";
import { candidateAppReleaseDirectory } from "./release-app-stage.mjs";
import { expectedArtifactLayout } from "./verify-packaged-artifact.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const mapPath = path.join(productRoot, "tests/test-impact-map.json");

function parseArguments(argv) {
  const options = {
    lane: "task",
    arch: "arm64",
    base: null,
    dryRun: false,
    realHtmlPath: null,
  };
  if (argv[0] && !argv[0].startsWith("--")) options.lane = argv.shift();
  while (argv.length > 0) {
    const argument = argv.shift();
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--base") options.base = argv.shift() || null;
    else if (argument === "--arch") options.arch = argv.shift() || "";
    else if (argument === "--real-html") options.realHtmlPath = argv.shift() || null;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^(?:edit|task|main|release|developer-package|candidate-app|artifact-only|artifact)$/u.test(options.lane)) {
    throw new Error(
      "Lane must be edit, task, main, release, developer-package, candidate-app, artifact-only or artifact.",
    );
  }
  if (!/^(?:arm64|x64)$/u.test(options.arch)) throw new Error("--arch must be arm64 or x64.");
  if (options.realHtmlPath) {
    const resolved = path.resolve(options.realHtmlPath);
    if (!path.isAbsolute(options.realHtmlPath) || path.extname(resolved).toLowerCase() !== ".html") {
      throw new Error("--real-html must be an absolute .html path.");
    }
    options.realHtmlPath = resolved;
  }
  return options;
}

async function runCapture(command, args, { allowFailure = false } = {}) {
  const child = spawn(command, args, {
    cwd: productRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  const errors = [];
  child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed: ${Buffer.concat(errors).toString("utf8").trim()}`);
  }
  return {
    code,
    stdout: Buffer.concat(chunks),
    stderr: Buffer.concat(errors),
  };
}

function nullSeparated(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean).map(normalizeRepositoryPath);
}

async function changedFiles(base) {
  const commands = [
    ["git", ["diff", "--name-only", "-z"]],
    ["git", ["diff", "--cached", "--name-only", "-z"]],
    ["git", ["ls-files", "--others", "--exclude-standard", "-z"]],
  ];
  if (base) commands.unshift(["git", ["diff", "--name-only", "-z", `${base}...HEAD`]]);
  const output = await Promise.all(commands.map(([command, args]) => runCapture(command, args)));
  return [...new Set(output.flatMap((entry) => nullSeparated(entry.stdout)))].sort();
}

async function repositoryEvidence(files) {
  const head = (await runCapture("git", ["rev-parse", "HEAD"])).stdout.toString("utf8").trim();
  const tree = (await runCapture("git", ["rev-parse", "HEAD^{tree}"])).stdout.toString("utf8").trim();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    const absolute = path.resolve(productRoot, file);
    if (!absolute.startsWith(`${productRoot}${path.sep}`)) continue;
    const info = await stat(absolute).catch(() => null);
    if (info?.isFile()) hash.update(await readFile(absolute));
    hash.update("\0");
  }
  return {
    head,
    tree,
    dirty: files.length > 0,
    changeSetSha256: `sha256:${hash.digest("hex")}`,
  };
}

function packageCommand(script) {
  return { command: "npm", args: ["run", script] };
}

function shellDisplay(command, args) {
  return [command, ...args].map((part) => (/^[a-z0-9_./:@=-]+$/iu.test(part)
    ? part
    : JSON.stringify(part))).join(" ");
}

function commandForSuite(suiteId, context) {
  const simple = {
    "build-web": packageCommand("build"),
    "build-desktop": packageCommand("desktop:renderer"),
    typecheck: packageCommand("typecheck"),
    lint: packageCommand("lint"),
    "dependency-audit": packageCommand("audit:dependencies"),
    "node-core": packageCommand("test:node:core:prepared"),
    "node-contract": packageCommand("test:contract:prepared"),
    "node-integration": packageCommand("test:node:integration:prepared"),
    "node-package": packageCommand("test:package"),
    "node-smoke": packageCommand("test:node:smoke:prepared"),
    "node-full": packageCommand("test:node:full:prepared"),
    "browser-smoke": packageCommand("test:browser:smoke:prepared"),
    "browser-full": packageCommand("test:browser:full:prepared"),
    "real-html": packageCommand("test:real-html:prepared"),
    "electron-smoke": packageCommand("test:electron:smoke:prepared"),
    "electron-full": packageCommand("test:electron:full:prepared"),
    "ai-smoke": packageCommand("test:ai-closed-loop:smoke:prepared"),
    "ai-closed-loop": packageCommand("test:ai-closed-loop:prepared"),
  };
  if (simple[suiteId]) return simple[suiteId];
  if (suiteId === "node-targeted") {
    return { command: process.execPath, args: ["--test", ...context.plan.selectedNodeTests.map((file) => path.join(productRoot, file))] };
  }
  if (suiteId === "package-build") {
    return {
      command: process.execPath,
      args: [path.join(productRoot, "scripts/build-package.mjs"), "--arch", context.options.arch],
    };
  }
  if (suiteId === "developer-package-build") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/build-package.mjs"),
        "--arch",
        context.options.arch,
        "--profile",
        "developer",
      ],
    };
  }
  if (suiteId === "candidate-app-build") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/build-package.mjs"),
        "--arch",
        context.options.arch,
        "--profile",
        "candidate-app",
      ],
    };
  }
  if (suiteId === "packaged-runtime") {
    return packageCommand("test:packaged-runtime:prepared");
  }
  if (suiteId === "developer-packaged-startup") {
    return packageCommand("test:packaged-startup:prepared");
  }
  if (suiteId === "candidate-app-runtime") {
    return packageCommand("test:packaged-runtime:prepared");
  }
  if (suiteId === "packaged-verify") {
    return {
      command: process.execPath,
      args: [path.join(productRoot, "scripts/verify-packaged-artifact.mjs"), "--arch", context.options.arch],
    };
  }
  if (suiteId === "developer-packaged-verify") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/verify-packaged-artifact.mjs"),
        "--arch",
        context.options.arch,
        "--profile",
        "developer",
      ],
    };
  }
  if (suiteId === "candidate-app-verify") {
    return {
      command: process.execPath,
      args: [
        path.join(productRoot, "scripts/verify-packaged-artifact.mjs"),
        "--arch",
        context.options.arch,
        "--profile",
        "candidate-app",
      ],
    };
  }
  throw new Error(`No command is defined for suite ${suiteId}.`);
}

async function runInherited(command, args, env) {
  const child = spawn(command, args, {
    cwd: productRoot,
    env,
    stdio: "inherit",
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} ended by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertReleaseRepositoryStable(repository) {
  const files = await changedFiles(null);
  const current = await repositoryEvidence(files);
  if (files.length > 0 || current.head !== repository.head || current.tree !== repository.tree) {
    throw new Error(
      "Clean source changed while the gate was running. Commit the final source and rerun the gate.",
    );
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const map = validateImpactMap(JSON.parse(await readFile(mapPath, "utf8")));
  const files = await changedFiles(options.base);
  if ((options.lane === "edit" || options.lane === "task") && files.length === 0) {
    throw new Error(
      `No changed files were found for the ${options.lane} gate. `
      + "Pass --base <git-ref> for a committed task, or use the release gate for complete coverage.",
    );
  }
  const cleanSourceLane = [
    "main",
    "release",
    "developer-package",
    "candidate-app",
    "artifact-only",
    "artifact",
  ].includes(options.lane);
  if (cleanSourceLane && files.length > 0) {
    throw new Error(
      `${options.lane} gates require a clean Git worktree. Commit every source change first.`,
    );
  }
  const plan = assertFullyAutomatedPlan(selectGatePlan({ map, lane: options.lane, changedFiles: files }));
  const repository = await repositoryEvidence(files);
  const packageJson = JSON.parse(await readFile(path.join(productRoot, "package.json"), "utf8"));
  const developerPreviewIdentity = options.lane === "developer-package"
    ? resolveDeveloperPreviewIdentity({ productRoot, packageJson })
    : null;
  const packagedPackageJson = developerPreviewIdentity
    ? developerPreviewPackageJson(packageJson, developerPreviewIdentity)
    : packageJson;
  if (options.lane === "artifact-only" || options.lane === "candidate-app") {
    if (process.env.PAGEROOT_SOURCE_GATE_TRUSTED !== "true") {
      throw new Error(`${options.lane} requires a trusted source-gate decision from CI.`);
    }
    if (
      process.env.PAGEROOT_SOURCE_GATE_TREE !== repository.tree
      || process.env.PAGEROOT_SOURCE_GATE_VERSION !== packageJson.version
    ) {
      throw new Error(
        `${options.lane} source-gate tree or version does not match the clean checkout.`,
      );
    }
  }
  const artifact = expectedArtifactLayout({
    productRoot,
    packageJson: packagedPackageJson,
    arch: options.arch,
    releaseDirectory: options.lane === "developer-package"
      ? developerPreviewReleaseDirectory(productRoot)
      : options.lane === "candidate-app"
        ? candidateAppReleaseDirectory(productRoot)
        : undefined,
    artifactName: options.lane === "developer-package"
      ? DEVELOPER_PREVIEW_ARTIFACT_PATTERN
      : undefined,
  });
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/gu, "-")}-${options.lane}`;
  const reportDirectory = path.join(productRoot, "output/test-runs", runId);
  await mkdir(reportDirectory, { recursive: true });
  const context = { options, plan, artifact };
  const selectedSuites = plan.suites.map((suite) => {
    const command = commandForSuite(suite.id, context);
    return { ...suite, command: shellDisplay(command.command, command.args) };
  });
  const selection = {
    schemaVersion: 1,
    runId,
    lane: options.lane,
    dryRun: options.dryRun,
    startedAt: startedAt.toISOString(),
    repository,
    changedFiles: files,
    selectedNodeTests: plan.selectedNodeTests,
    suites: selectedSuites,
    options: {
      arch: options.arch,
      base: options.base,
      realHtmlPath: options.realHtmlPath,
    },
  };
  await writeJson(path.join(reportDirectory, "selection.json"), selection);

  console.log(`Automated ${options.lane} gate: ${selectedSuites.length} step(s)`);
  console.log(`Evidence: ${reportDirectory}`);
  for (const suite of selectedSuites) console.log(`- ${suite.id}: ${suite.command}`);

  const results = [];
  if (!options.dryRun) {
    for (const suite of selectedSuites) {
      if (cleanSourceLane) {
        await assertReleaseRepositoryStable(repository);
      }
      const command = commandForSuite(suite.id, context);
      const suiteStartedAt = new Date();
      console.log(`\n[${suite.id}] ${shellDisplay(command.command, command.args)}`);
      const env = {
        ...process.env,
        ...(options.realHtmlPath && suite.id === "real-html"
          ? { PAGEROOT_REAL_HTML_PATH: options.realHtmlPath }
          : {}),
        ...((suite.id === "packaged-runtime"
          || suite.id === "developer-packaged-startup"
          || suite.id === "candidate-app-runtime")
          ? {
            PAGEROOT_PACKAGED_APP_PATH: artifact.appPath,
            PAGEROOT_EXPECTED_APP_VERSION: artifact.version,
            PAGEROOT_EXPECTED_PRODUCT_NAME: artifact.productName,
            PAGEROOT_TEST_ARCH: options.arch,
          }
          : {}),
      };
      let exitCode = 1;
      let failure = null;
      try {
        exitCode = await runInherited(command.command, command.args, env);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      const suiteCompletedAt = new Date();
      results.push({
        id: suite.id,
        status: exitCode === 0 && !failure ? "passed" : "failed",
        exitCode,
        failure,
        startedAt: suiteStartedAt.toISOString(),
        completedAt: suiteCompletedAt.toISOString(),
        durationMs: suiteCompletedAt.getTime() - suiteStartedAt.getTime(),
        command: shellDisplay(command.command, command.args),
      });
      await writeJson(path.join(reportDirectory, "results.json"), { results });
      if (exitCode !== 0 || failure) break;
    }
    if (!results.some((result) => result.status === "failed")
      && cleanSourceLane) {
      await assertReleaseRepositoryStable(repository);
    }
  }

  const failed = results.find((result) => result.status === "failed");
  let developerPreviewAttestation = null;
  if (
    !options.dryRun
    && !failed
    && options.lane === "developer-package"
  ) {
    const record = await writeDeveloperPreviewAttestation({
      productRoot,
      artifact,
      identity: developerPreviewIdentity,
      repository,
      architecture: options.arch,
      results,
    });
    developerPreviewAttestation = path.relative(productRoot, record.destination);
    console.log(`Developer preview attestation: ${record.destination}`);
  }
  const completedAt = new Date();
  const summary = {
    schemaVersion: 1,
    runId,
    lane: options.lane,
    status: options.dryRun ? "dry-run" : failed ? "failed" : "passed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    selectedCount: selectedSuites.length,
    executedCount: results.length,
    passedCount: results.filter((result) => result.status === "passed").length,
    failedSuite: failed?.id || null,
    developerPreviewAttestation,
    results,
  };
  await writeJson(path.join(reportDirectory, "results.json"), summary);
  console.log(`\nGate ${summary.status}. Report: ${path.join(reportDirectory, "results.json")}`);
  if (failed) process.exitCode = failed.exitCode || 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
