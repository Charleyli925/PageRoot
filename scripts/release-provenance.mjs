import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const defaultProductRoot = path.resolve(path.dirname(scriptPath), "..");
export const buildInfoRelativePath = "output/release-metadata/build-info.json";

function git(productRoot, args) {
  const result = spawnSync("git", args, {
    cwd: productRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

export function readRepositoryIdentity(productRoot = defaultProductRoot) {
  const status = git(productRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return Object.freeze({
    commitSha: git(productRoot, ["rev-parse", "HEAD"]),
    treeSha: git(productRoot, ["rev-parse", "HEAD^{tree}"]),
    dirty: status.length > 0,
    dirtyPaths: status ? status.split("\n") : [],
  });
}

export async function expectedBuildInfo({
  productRoot = defaultProductRoot,
  architecture,
  requireClean = true,
  version,
} = {}) {
  if (!/^(?:arm64|x64)$/u.test(architecture || "")) {
    throw new Error("architecture must be arm64 or x64");
  }
  const packageJson = JSON.parse(await readFile(path.join(productRoot, "package.json"), "utf8"));
  const effectiveVersion = version ?? packageJson.version;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(effectiveVersion || "")) {
    throw new Error("build version must be a semantic version");
  }
  const repository = readRepositoryIdentity(productRoot);
  if (requireClean && repository.dirty) {
    throw new Error(
      "Release packaging requires a clean Git worktree. Commit or stash every source change first.\n"
      + repository.dirtyPaths.slice(0, 20).join("\n"),
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    name: packageJson.name,
    version: effectiveVersion,
    architecture,
    sourceRepository: "https://github.com/Charleyli925/PageRoot",
    commitSha: repository.commitSha,
    treeSha: repository.treeSha,
  });
}

export async function writeBuildInfo({
  productRoot = defaultProductRoot,
  architecture,
  version,
} = {}) {
  const expected = await expectedBuildInfo({
    productRoot,
    architecture,
    requireClean: true,
    version,
  });
  const buildInfo = Object.freeze({
    ...expected,
    builtAt: new Date().toISOString(),
  });
  const destination = path.join(productRoot, buildInfoRelativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
  return { buildInfo, destination };
}

export function assertBuildInfo(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Packaged build-info.json must be an object.");
  }
  const allowedKeys = new Set([
    "schemaVersion",
    "name",
    "version",
    "architecture",
    "sourceRepository",
    "commitSha",
    "treeSha",
    "builtAt",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Packaged build-info.json contains unsupported fields.");
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      throw new Error(`Packaged build provenance mismatch for ${key}.`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.builtAt || "")) {
    throw new Error("Packaged build provenance has an invalid builtAt timestamp.");
  }
  if (!/^(?:arm64|x64)$/u.test(value.architecture || "")) {
    throw new Error("Packaged build provenance has an invalid architecture.");
  }
  if (value.sourceRepository !== "https://github.com/Charleyli925/PageRoot") {
    throw new Error("Packaged build provenance has an unexpected source repository.");
  }
  if (!/^[0-9a-f]{40}$/u.test(value.commitSha || "") || !/^[0-9a-f]{40}$/u.test(value.treeSha || "")) {
    throw new Error("Packaged build provenance has an invalid Git identity.");
  }
  return Object.freeze({ ...value });
}
