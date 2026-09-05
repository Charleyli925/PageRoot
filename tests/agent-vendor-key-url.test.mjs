import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_VENDOR_KEY_VENDOR_IDS,
  publicAgentVendorKeyUrl,
} from "../shared/agent-vendor-key-url.mjs";

test("vendor Key pages are fixed https URLs for built-in vendors only", () => {
  assert.deepEqual([...AGENT_VENDOR_KEY_VENDOR_IDS].sort(), [
    "dashscope", "deepseek", "openai", "zhipu",
  ]);
  assert.equal(
    publicAgentVendorKeyUrl("deepseek"),
    "https://platform.deepseek.com/api_keys",
  );
  assert.equal(publicAgentVendorKeyUrl("custom"), null);
  assert.equal(publicAgentVendorKeyUrl("https://evil.example/"), null);
  assert.match(publicAgentVendorKeyUrl("openai"), /^https:\/\/platform\.openai\.com\//u);
});
