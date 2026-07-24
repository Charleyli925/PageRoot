import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBuildInfo,
  expectedBuildInfo,
  readRepositoryIdentity,
} from "../scripts/release-provenance.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture(overrides = {}) {
  return {
    schemaVersion: 1,
    name: "pageroot",
    version: "0.8.6",
    architecture: "arm64",
    sourceRepository: "https://github.com/Charleyli925/PageRoot",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    builtAt: "2026-07-23T00:00:00.000Z",
    ...overrides,
  };
}

test("build provenance is strict and identifies one source tree", () => {
  assert.deepEqual(
    assertBuildInfo(fixture(), {
      schemaVersion: 1,
      name: "pageroot",
      version: "0.8.6",
      architecture: "arm64",
    }),
    fixture(),
  );
  for (const invalid of [
    fixture({ architecture: "universal" }),
    fixture({ commitSha: "not-a-commit" }),
    fixture({ sourceRepository: "https://example.com/fork" }),
    fixture({ builtAt: "today" }),
    { ...fixture(), extra: true },
  ]) {
    assert.throws(() => assertBuildInfo(invalid, { version: "0.8.6" }));
  }
});

test("repository identity and expected build info come from the active checkout", async () => {
  const repository = readRepositoryIdentity(productRoot);
  assert.match(repository.commitSha, /^[0-9a-f]{40}$/u);
  assert.match(repository.treeSha, /^[0-9a-f]{40}$/u);
  const expected = await expectedBuildInfo({
    productRoot,
    architecture: "arm64",
    requireClean: false,
  });
  assert.equal(expected.commitSha, repository.commitSha);
  assert.equal(expected.treeSha, repository.treeSha);
  assert.equal(expected.version, "0.8.6");
});
