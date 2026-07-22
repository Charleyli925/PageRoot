import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import smokeConfig from "./e2e/electron/playwright.ai-smoke.config.mjs";

test("AI smoke configuration selects one success and one fail-closed scope path", async () => {
  const source = await readFile(
    new URL("./e2e/electron/ai-handoff-closed-loop.spec.mjs", import.meta.url),
    "utf8",
  );
  const titles = [...source.matchAll(/test\("([^"]+)"/gu)].map((match) => match[1]);
  const selected = titles.filter((title) => smokeConfig.grep.test(title));
  assert.deepEqual(selected, [
    "a verified AI result stays pending until the user opens the new HTML",
    "a soft out-of-scope AI return waits for an explicit waiver and open",
  ]);
  assert.match(
    source,
    /await applicationClosed;[\s\S]*?rmSync\(resolved/u,
    "AI teardown must observe the Electron close event before deleting Bridge-owned files",
  );
  assert.doesNotMatch(
    source,
    /if \(await processButton\.isVisible\(\)\) await processButton\.click\(\)/u,
    "process-board navigation must wait for its control instead of sampling visibility once",
  );
});
