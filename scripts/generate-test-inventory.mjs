import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeTestGroups } from "./test-node-group.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

async function walk(directory, matches = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, matches);
    else if (entry.isFile() && entry.name.endsWith(".spec.mjs")) matches.push(fullPath);
  }
  return matches;
}

function parseSpecTests(source, file) {
  const tests = [];
  const pattern = /^test(?:\.(?:skip|only|fixme))?\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gmu;
  let match;
  while ((match = pattern.exec(source))) {
    const title = match[2].replaceAll("\\n", " ").replaceAll("\\'", "'");
    const after = source.slice(match.index, match.index + 400);
    const tags = [...after.matchAll(/"(@[a-z0-9-]+)"/gu)].map((item) => item[1]);
    tests.push({
      title,
      tags: [...new Set(tags.filter((tag) => tag.startsWith("@smoke-") || tag === "@gate-smoke" || tag === "@infra-sensitive"))],
    });
  }
  return tests.map((test) => ({ file, ...test }));
}

export async function collectTestInventory(root = productRoot) {
  const specFiles = (await walk(path.join(root, "tests/e2e")))
    .map((file) => path.relative(root, file).replaceAll("\\", "/"))
    .sort();
  const playwright = [];
  for (const file of specFiles) {
    const source = await readFile(path.join(root, file), "utf8");
    playwright.push(...parseSpecTests(source, file));
  }
  const groups = await nodeTestGroups(path.join(root, "tests"));
  const node = Object.fromEntries(
    Object.entries(groups).map(([group, files]) => [
      group,
      files.map((file) => path.relative(root, file).replaceAll("\\", "/")).sort(),
    ]),
  );
  return {
    generatedBy: "scripts/generate-test-inventory.mjs",
    specFiles,
    playwright,
    node,
  };
}

function missingReadmeSpecs(readme, specFiles) {
  const mentioned = [...readme.matchAll(/`([a-z0-9.-]+\.spec\.mjs)`/gu)].map((item) => item[1]);
  return mentioned.filter((name) => !specFiles.some((file) => file.endsWith(`/${name}`) || file.endsWith(name)));
}

export async function assertTestInventory(root = productRoot) {
  const inventory = await collectTestInventory(root);
  const readme = await readFile(path.join(root, "tests/e2e/README.md"), "utf8");
  const missing = missingReadmeSpecs(readme, inventory.specFiles);
  if (missing.length > 0) {
    throw new Error(`E2E README lists specs that are not in the repository: ${missing.join(", ")}`);
  }
  if (inventory.playwright.length < 1) {
    throw new Error("Playwright inventory is empty.");
  }
  return inventory;
}

async function run() {
  const inventory = await assertTestInventory();
  const outputPath = path.join(productRoot, "tests/TEST_INVENTORY.json");
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  process.stdout.write(`${inventory.specFiles.length} spec files, ${inventory.playwright.length} Playwright tests, ${inventory.node.full.length} Node tests\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
