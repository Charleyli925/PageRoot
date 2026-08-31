import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(productRoot, relativePath), "utf8");

test("ADR 0066/0068 and the architecture contract keep source Review authoritative", () => {
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
    "semantic source matcher remains",
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
    "bounded observation reports whether sampled CSS cascade, layout, Canvas/SVG",
  ]) {
    assert.ok(normalizedAdr.includes(required), `ADR 0066 lost required contract: ${required}`);
  }
  for (const required of [
    "Review source facts remain authoritative",
    "makes only visual enhancement `unsupported`",
    "existing semantic source matcher remains available",
    "plan contains only hosts implicated by a source difference",
    "`evidenceStableIds[]`",
    "best-effort `changed / unchanged / unverified`",
    "not an isolated security oracle",
    "one Review-wide time, node and pixel budget",
    "there is no `.slice(0, 1000)`",
    "both-side-hidden source facts are also `unverified`",
    "remain in filters, navigation and markers",
    "fixed to the right edge of the Before pane",
    "aggregate to `评2`/`评3`",
  ]) {
    assert.ok(normalizedVisualAdr.includes(required), `ADR 0068 lost required contract: ${required}`);
  }
  for (const required of [
    "remains Review fact authority",
    "identical common Stable IDs are not observed",
    "`evidenceStableIds[]`",
    "not an isolated security oracle",
    "makes visual enhancement `unsupported`, but does not cancel source Review",
    "existing semantic matcher remains the historical-source fallback",
    "Every planned observation settles to `changed`, `unchanged` or `unverified`",
    "those verdicts never replace deterministic source facts",
    "hidden, stale, unsupported and budget-limited source changes stay",
    "Equal bounded summaries for pure CSS/Script or style evidence remain `unverified`",
  ]) {
    assert.ok(normalizedArchitecture.includes(required), `Architecture Contract lost boundary: ${required}`);
  }
});
