import assert from "node:assert/strict";
import test from "node:test";

import { architectureViolations } from "../scripts/check-architecture.mjs";

test("renderer, application, domain, and Bridge dependency boundaries stay enforced", async () => {
  assert.deepEqual(await architectureViolations(), []);
});
