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
    "Historical elements genuinely without IDs retain",
    "Any element that carries `data-pageroot-id` claims persistent identity",
    "exact-subtree, relocation, singleton, weighted or fuzzy pairing",
    "appears as element removal plus addition even when its content or markup is unchanged",
    "globally ambiguous across the whole document pair",
    "If it does not pair by the same valid, unique ID",
    "same persistent ID remains paired when the authored element tag changes",
    "newly added no-ID `<style>`",
    "groups common IDs by parent in one pass",
    "sibling indexes are likewise built once per parent",
    "compares stable descendants through their individual IDs",
    "Moving text between different stable descendants",
    "Candidate regions and their pairing are frozen from the authored DOM",
    "distinct semantic and geometry owner namespaces",
    "suppresses only that root's false presence fact",
    "images, modules and other non-text elements",
    "`added`, `removed`, `moved`, `attribute`, `style`, `css-source` and",
    "CSS cascade effects, layout, wrapping, animation state, Canvas/SVG",
  ]) {
    assert.ok(normalizedAdr.includes(required), `ADR 0066 lost required contract: ${required}`);
  }
  for (const required of [
    "unique valid stable-ID pairs",
    "Review never serializes, compares or trusts Runtime DOM",
    "legacy no-ID Versions retain the old matcher",
    "Any element carrying `data-pageroot-id` claims persistent identity",
    "cannot re-enter pairing through exact-subtree, relocation, singleton, weighted or fuzzy evidence",
    "reported as removal plus addition even when markup is unchanged",
    "never bridges an identified element to a different or missing persistent ID",
    "same persistent ID pairs independently of an authored tag-kind change",
    "adding a no-ID `<style>`",
    "Per-parent rescans of the complete inventory",
    "per-child rescans of siblings are forbidden",
    "byte-identical markup cannot hide a precomputed movement",
    "compares each stable descendant against its exact before/after ID counterpart",
    "never through flattened whole-subtree text",
    "Text transferred between different stable descendants",
    "Authored candidate regions and their pairing are frozen",
    "distinct semantic/geometry owner namespace",
    "suppresses only its own false addition/removal",
    "unchanged moved text produces no text fact",
    "a common stable ID cannot degrade into",
  ]) {
    assert.ok(normalizedArchitecture.includes(required), `Architecture Contract lost boundary: ${required}`);
  }
});
