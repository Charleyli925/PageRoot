import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import smokeConfig from "./e2e/electron/playwright.ai-smoke.config.mjs";

test("AI smoke configuration selects review activation and broad-edit regression paths", async () => {
  const source = await readFile(
    new URL("./e2e/electron/ai-handoff-closed-loop.spec.mjs", import.meta.url),
    "utf8",
  );
  const titles = [...source.matchAll(/test\("([^"]+)"/gu)].map((match) => match[1]);
  const selected = titles.filter((title) => smokeConfig.grep.test(title));
  assert.deepEqual(selected, [
    "a verified AI result stays pending through desktop review until the user accepts it",
    "a broad but related AI return is accepted without a target-scope error",
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
