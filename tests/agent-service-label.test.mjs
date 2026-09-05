import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_SERVICE_ORDER,
  agentServiceLabel,
  agentServicePrimaryAction,
  agentServiceStatusText,
  sidebarServiceTriggerText,
} from "../app/application/agent-service-label.js";

test("service labels stay product names while ids stay pageroot/qoder/codex", () => {
  assert.deepEqual([...AGENT_SERVICE_ORDER], ["pageroot", "qoder", "codex"]);
  assert.equal(agentServiceLabel("pageroot"), "内置 AI");
  assert.equal(agentServiceLabel("qoder"), "Qoder");
  assert.equal(agentServiceLabel("codex"), "Codex");
});

test("compact rows name status without repeating the service", () => {
  assert.equal(agentServiceStatusText({
    availability: { status: "auth-required" },
  }), "尚未连接");
  assert.equal(agentServiceStatusText({
    availability: { status: "ready", reason: "disabled" },
  }), "已断开");
  assert.equal(agentServiceStatusText({
    availability: { status: "ready" },
    providerId: "codex",
    isDefault: true,
  }), "已连接 · 默认");
  assert.equal(agentServiceStatusText({
    availability: { status: "ready" },
    providerId: "pageroot",
    connection: { vendorDisplayName: "DeepSeek" },
    modelDisplayName: "deepseek-v4-pro",
  }), "DeepSeek · deepseek-v4-pro");
});

test("one primary action per row", () => {
  assert.deepEqual(agentServicePrimaryAction({
    availability: { status: "auth-required" },
  }), { kind: "connect", label: "连接" });
  assert.deepEqual(agentServicePrimaryAction({
    availability: { status: "ready" },
    isDefault: true,
  }), { kind: "manage", label: "管理" });
  assert.deepEqual(agentServicePrimaryAction({
    availability: { status: "ready" },
    isDefault: false,
  }), { kind: "default", label: "设为默认" });
});

test("the sidebar trigger names the connected vendor or the service", () => {
  assert.equal(sidebarServiceTriggerText({
    providerId: "codex",
    catalogStatus: "ready",
    modelDisplayName: "gpt-5",
  }), "Codex · gpt-5");
  assert.equal(sidebarServiceTriggerText({
    providerId: "pageroot",
    catalogStatus: "ready",
    connectionVendorName: "DeepSeek",
    modelDisplayName: "deepseek-v4-pro",
  }), "DeepSeek · deepseek-v4-pro");
  assert.equal(sidebarServiceTriggerText({
    providerId: "qoder",
    catalogStatus: "auth-required",
  }), "Qoder · 尚未连接");
});
