import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("setup-pageroot-npm composite action can load without unsupported step timeouts", async () => {
  const source = await readFile(
    path.join(productRoot, ".github/actions/setup-pageroot-npm/action.yml"),
    "utf8",
  );
  assert.match(source, /^runs:\n  using: composite\n/mu);
  assert.doesNotMatch(source, /^\s+timeout-minutes:/mu);
  assert.match(source, /Recover npm dependencies on cache miss/u);
  assert.match(source, /running npm ci as a controlled recovery path/u);
});
