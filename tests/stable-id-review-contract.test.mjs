import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(productRoot, relativePath), "utf8");

test("ADR 0066 and the architecture contract freeze stable-ID source Review", () => {
  const adr = read("docs/decisions/0066-stable-id-source-review.md");
  const architecture = read("docs/ARCHITECTURE_CONTRACT.md");
  const normalizedAdr = adr.replace(/\s+/gu, " ");
  const normalizedArchitecture = architecture.replace(/\s+/gu, " ");

  for (const required of [
    "valid, unique `data-pageroot-id`",
    "same-parent reorder or cross-parent move",
    "Historical inputs without IDs retain",
    "Candidate that churned every ID, uses that legacy matcher for the whole pair",
    "globally ambiguous across the whole document pair",
    "only whole-element `added`/`removed` facts own descendant text",
    "`added`, `removed`, `moved`, `attribute`, `style`, `css-source` and",
    "CSS cascade effects, layout, wrapping, animation state, Canvas/SVG",
  ]) {
    assert.ok(normalizedAdr.includes(required), `ADR 0066 lost required contract: ${required}`);
  }
  for (const required of [
    "unique valid stable-ID pairs",
    "Review never serializes, compares or trusts Runtime DOM",
    "legacy no-ID Versions retain the old matcher",
    "full ID churn cannot become false source additions/removals",
    "cannot re-enter pairing through exact-subtree, relocation or fuzzy evidence",
    "byte-identical markup cannot hide a precomputed movement",
    "Only `added`/`removed` whole-element facts suppress descendant text evidence",
    "a common stable ID cannot degrade into",
  ]) {
    assert.ok(normalizedArchitecture.includes(required), `Architecture Contract lost boundary: ${required}`);
  }
});
