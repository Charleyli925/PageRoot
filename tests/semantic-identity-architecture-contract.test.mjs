import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(productRoot, relativePath), "utf8")
  .replace(/\s+/gu, " ");

test("Stable ID semantic saves keep one identity and one Repository authorization contract", () => {
  const identity = read("docs/decisions/0060-working-copy-source-element-identity-migration.md");
  const comments = read("docs/decisions/0061-stable-current-comment-targets.md");
  const kernel = read("docs/decisions/0062-semantic-source-operation-kernel.md");
  const structure = read("docs/decisions/0064-stable-id-source-structure-editing.md");
  const architecture = read("docs/ARCHITECTURE_CONTRACT.md");

  for (const required of [
    "`data-pageroot-id` alone defines element continuity",
    "SourcePatch `kind` is never product authorization",
    "Insert and duplicate add only fresh subtree IDs",
    "`replaceSubtree` retains the target root ID",
    "Without this semantic proof",
    "external writes cannot borrow that authority",
  ]) {
    assert.ok(identity.includes(required), `ADR 0060 lost save contract: ${required}`);
  }
  for (const required of [
    "`elementId` is the sole persistent element identity",
    "including when its authored tag changes",
    "A missing or invalid ID resolves `orphaned`",
    "without changing or transferring its source identity",
  ]) {
    assert.ok(comments.includes(required), `ADR 0061 lost target contract: ${required}`);
  }
  for (const required of [
    "system-derived `identityDelta`",
    "`replaceSubtree` retains the target root ID, may change its tag",
    "session-local exact restore values",
    "not persistent or collaborative semantic commands",
  ]) {
    assert.ok(kernel.includes(required), `ADR 0062 lost kernel contract: ${required}`);
  }
  for (const required of [
    "a system-derived `identityDelta`",
    "never supplied as caller authority",
    "legacy patch `kind` cannot authorize",
    "Successful save reseals",
  ]) {
    assert.ok(structure.includes(required), `ADR 0064 lost structure contract: ${required}`);
  }
  for (const required of [
    "stable ID is the sole element identity",
    "recomputes its ID-set and topology delta",
    "patch `kind` cannot authorize identity changes",
    "session-local exact restore evidence",
    "binding; this seal detects later external topology drift but is not a second element identity",
    "Without semantic proof, additions, removals, swaps, transplants, forgeries",
  ]) {
    assert.ok(
      architecture.includes(required),
      `Architecture Contract lost semantic identity boundary: ${required}`,
    );
  }
});
