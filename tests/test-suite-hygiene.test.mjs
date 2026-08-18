import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testsRoot = path.dirname(fileURLToPath(import.meta.url));

const TEST_TITLE = /^\s*test\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gmu;

async function nodeTestFiles() {
  return (await readdir(testsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
}

// A rebase or conflict resolution can re-add a block a previous branch already
// landed. The suite still passes, because a duplicated test is a passing test,
// so nothing else in the ladder reports it. The only visible symptom is inflated
// apparent coverage: a subject looks twice as covered as it is.
test("no Node test file declares the same literal test title twice", async () => {
  const offenders = [];
  for (const name of await nodeTestFiles()) {
    const source = await readFile(path.join(testsRoot, name), "utf8");
    const seen = new Map();
    for (const match of source.matchAll(TEST_TITLE)) {
      const title = match[2];
      seen.set(title, (seen.get(title) || 0) + 1);
    }
    for (const [title, count] of seen) {
      if (count > 1) offenders.push(`${name}: ${count}× ${JSON.stringify(title)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Duplicate test titles found:\n${offenders.join("\n")}`,
  );
});
