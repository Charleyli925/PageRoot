import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(productRoot, relativePath), "utf8");

test("ADR 0066/0068 and the architecture contract freeze modern visual Review", () => {
  const adr = read("docs/decisions/0066-stable-id-source-review.md");
  const visualAdr = read("docs/decisions/0068-review-visual-verdict-gate.md");
  const architecture = read("docs/ARCHITECTURE_CONTRACT.md");
  const normalizedAdr = adr.replace(/\s+/gu, " ");
  const normalizedVisualAdr = visualAdr.replace(/\s+/gu, " ");
  const normalizedArchitecture = architecture.replace(/\s+/gu, " ");

  for (const required of [
    "valid, unique `data-pageroot-id`",
    "same-parent reorder or cross-parent move",
    "Any element that carries `data-pageroot-id` claims persistent identity",
    "exact-subtree, relocation, singleton, weighted or fuzzy pairing",
    "appears as element removal plus addition even when its content or markup is unchanged",
    "globally ambiguous across the whole document pair",
    "does not enter a legacy matcher",
    "same persistent ID remains paired when the authored element tag changes",
    "groups common IDs by parent in one pass",
    "sibling indexes are likewise built once per parent",
    "compares stable descendants through their individual IDs",
    "Moving text between different stable descendants",
    "Candidate regions and their pairing are frozen from the authored DOM",
    "distinct semantic and geometry owner namespaces",
    "suppresses only that root's false presence fact",
    "images, modules and other non-text elements",
    "`added`, `removed`, `moved`, `attribute`, `style`, `css-source` and",
    "bounded observation decides whether CSS cascade, layout, Canvas/SVG",
  ]) {
    assert.ok(normalizedAdr.includes(required), `ADR 0066 lost required contract: ${required}`);
  }
  for (const required of [
    "complete, valid and document-unique",
    "There is no semantic matcher",
    "challenge-bound `MessagePort` per frame side",
    "Common Stable IDs require a matching trusted observation from both sides",
    "source-proven absence",
    "Two samples across animation frames must agree",
    "WebGL, tainted Canvas",
    "Pending and unverified candidates never enter changes",
    "fixed to the right edge of the Before pane",
    "aggregate to `评2`/`评3`",
  ]) {
    assert.ok(normalizedVisualAdr.includes(required), `ADR 0068 lost required contract: ${required}`);
  }
  for (const required of [
    "SourceEvidence",
    "Those facts are never user-visible changes by themselves",
    "one-shot `MessagePort`",
    "WebGL, tainted Canvas, live media",
    "absent, partial, malformed or duplicate identity is explicitly unsupported",
    "Exact-subtree, title/class/id, sibling index, relocation, singleton, weighted and fuzzy matchers are never entered",
    "Character alignment is allowed only inside a pair already proven by the same Stable ID",
    "Every candidate settles to `changed`, `unchanged` or `unverified`",
    "Only `changed` enters the existing `全部 / 文字 / 元素` filters",
    "`unverified` creates no change or count and remains normally visible",
  ]) {
    assert.ok(normalizedArchitecture.includes(required), `Architecture Contract lost boundary: ${required}`);
  }
});
