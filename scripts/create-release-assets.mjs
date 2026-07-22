#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expectedBuildInfo, assertBuildInfo, buildInfoRelativePath } from "./release-provenance.mjs";
import { expectedArtifactLayout } from "./verify-packaged-artifact.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

function parseArchitecture(argv) {
  if (argv.length !== 2 || argv[0] !== "--arch" || !/^(?:arm64|x64)$/u.test(argv[1])) {
    throw new Error("Usage: node scripts/create-release-assets.mjs --arch <arm64|x64>");
  }
  return argv[1];
}

async function main() {
  const architecture = parseArchitecture(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(path.join(productRoot, "package.json"), "utf8"));
  const layout = expectedArtifactLayout({ productRoot, packageJson, arch: architecture });
  const expected = await expectedBuildInfo({ productRoot, architecture, requireClean: true });
  const buildInfo = assertBuildInfo(
    JSON.parse(await readFile(path.join(productRoot, buildInfoRelativePath), "utf8")),
    expected,
  );
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${packageJson.version}`) {
    throw new Error(`Tag ${process.env.GITHUB_REF_NAME} does not match package version ${packageJson.version}.`);
  }

  const dmg = await readFile(layout.dmgPath);
  const checksum = createHash("sha256").update(dmg).digest("hex");
  const manifest = {
    schemaVersion: 1,
    version: packageJson.version,
    minimumMacOS: packageJson.build.mac.minimumSystemVersion,
    architectures: [architecture],
    publishedAt: buildInfo.builtAt,
  };
  await Promise.all([
    writeFile(
      path.join(layout.releaseDirectory, "update-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(layout.releaseDirectory, "SHA256SUMS.txt"),
      `${checksum}  ${path.basename(layout.dmgPath)}\n`,
      "utf8",
    ),
    copyFile(
      path.join(productRoot, buildInfoRelativePath),
      path.join(layout.releaseDirectory, "build-info.json"),
    ),
  ]);
  console.log(`Release assets created in ${layout.releaseDirectory}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
