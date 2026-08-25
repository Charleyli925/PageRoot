#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const lockPath = path.join(productRoot, "scripts", "agent", "codex-runtime-lock.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function json(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function regularFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files;
}

async function treeFingerprint(root) {
  const files = (await regularFiles(root)).sort();
  const digest = createHash("sha256");
  for (const relativePath of files) {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(sha256(await readFile(path.join(root, relativePath))));
    digest.update("\n");
  }
  return Object.freeze({ count: files.length, sha256: digest.digest("hex") });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} drifted: expected ${expected}, received ${actual}.`);
  }
}

function runCodex(codexEntry, args) {
  const result = spawnSync(process.execPath, [codexEntry, ...args], {
    cwd: productRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH || "",
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`Pinned Codex schema generation failed: ${result.stderr.trim()}`);
  }
}

export async function verifyCodexRuntimeLock() {
  const [manifest, packageJson, packageLock] = await Promise.all([
    json(lockPath),
    json(path.join(productRoot, "package.json")),
    json(path.join(productRoot, "package-lock.json")),
  ]);
  const packages = packageLock.packages || {};
  for (const [key, descriptor] of [
    ["adapter", manifest.adapter],
    ["acpSdk", manifest.acpSdk],
    ["codex", manifest.codex],
  ]) {
    assertEqual(packageJson.dependencies?.[descriptor.name], descriptor.version, `${key} dependency`);
    const locked = packages[`node_modules/${descriptor.name}`];
    assertEqual(locked?.version, descriptor.version, `${key} lock version`);
    assertEqual(locked?.integrity, descriptor.integrity, `${key} integrity`);
    assertEqual(locked?.license, descriptor.license, `${key} license`);
  }
  assertEqual(
    packageJson.overrides?.[manifest.adapter.name]?.[manifest.codex.name],
    manifest.codex.version,
    "adapter Codex override",
  );
  assertEqual(
    packageJson.overrides?.[manifest.adapter.name]?.[manifest.acpSdk.name],
    manifest.acpSdk.version,
    "adapter ACP SDK override",
  );

  const adapterEntry = path.join(
    productRoot,
    "node_modules",
    "@agentclientprotocol",
    "codex-acp",
    "dist",
    "index.js",
  );
  const codexEntry = path.join(productRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
  assertEqual(sha256(await readFile(adapterEntry)), manifest.adapter.entrySha256, "adapter entry hash");
  assertEqual(sha256(await readFile(codexEntry)), manifest.codex.wrapperSha256, "Codex wrapper hash");

  const platformKey = `${process.platform}-${process.arch}`;
  if (platformKey === manifest.codex.supportedPackageTarget) {
    const platformRoot = path.join(productRoot, "node_modules", "@openai", `codex-${platformKey}`);
    const platformManifest = await json(path.join(platformRoot, "package.json"));
    assertEqual(
      platformManifest.version,
      manifest.codex.platformPackage.version,
      "Codex platform package version",
    );
    const locked = packages[`node_modules/@openai/codex-${platformKey}`];
    assertEqual(locked?.integrity, manifest.codex.platformPackage.integrity, "Codex platform integrity");
    const triple = "aarch64-apple-darwin";
    const vendorRoot = path.join(platformRoot, "vendor", triple);
    assertEqual(
      sha256(await readFile(path.join(vendorRoot, "bin", "codex"))),
      manifest.codex.platformPackage.binarySha256,
      "Codex binary hash",
    );
    assertEqual(
      sha256(await readFile(path.join(vendorRoot, "codex-package.json"))),
      manifest.codex.platformPackage.packageManifestSha256,
      "Codex package manifest hash",
    );
  }

  const generatedRoot = await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-schema-"));
  try {
    const jsonRoot = path.join(generatedRoot, "json");
    const typescriptRoot = path.join(generatedRoot, "typescript");
    runCodex(codexEntry, ["app-server", "generate-json-schema", "--out", jsonRoot]);
    runCodex(codexEntry, ["app-server", "generate-ts", "--out", typescriptRoot]);
    const [jsonTree, typescriptTree] = await Promise.all([
      treeFingerprint(jsonRoot),
      treeFingerprint(typescriptRoot),
    ]);
    assertEqual(jsonTree.count, manifest.appServerSchema.jsonFileCount, "JSON Schema file count");
    assertEqual(jsonTree.sha256, manifest.appServerSchema.jsonTreeSha256, "JSON Schema tree hash");
    assertEqual(
      typescriptTree.count,
      manifest.appServerSchema.typescriptFileCount,
      "TypeScript schema file count",
    );
    assertEqual(
      typescriptTree.sha256,
      manifest.appServerSchema.typescriptTreeSha256,
      "TypeScript schema tree hash",
    );
  } finally {
    await rm(generatedRoot, { recursive: true, force: true });
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  verifyCodexRuntimeLock().then((manifest) => {
    console.log(
      `Codex runtime lock verified: ${manifest.adapter.version} -> ${manifest.codex.version}.`,
    );
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
