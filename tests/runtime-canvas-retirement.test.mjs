import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("multi-tab Runtime Canvas retention is disabled while the old pool remains", () => {
  const workbench = readFileSync(new URL("../app/workbench.tsx", import.meta.url), "utf8");
  const residency = readFileSync(
    new URL("../app/workbench/use-runtime-canvas-residency.ts", import.meta.url),
    "utf8",
  );
  assert.match(workbench, /retentionEnabled:\s*false/u);
  assert.match(residency, /if \(!retentionEnabled\) \{\s*session\.reconcile\(\[\]\)/u);
  assert.match(workbench, /<WorkbenchDocumentCanvasPool/u);
});
