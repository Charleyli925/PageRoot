import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("the legacy Qoder card is a presentation-only wrapper over the neutral card", async () => {
  const [wrapper, card] = await Promise.all([
    source("../app/components/QoderAvailabilityCard.tsx"),
    source("../app/components/AgentProviderCard.tsx"),
  ]);
  assert.match(wrapper, /import AgentProviderCard from "\.\/AgentProviderCard"/u);
  assert.match(wrapper, /<AgentProviderCard \{\.\.\.props\} presentation=\{QODER_CARD_PRESENTATION\}/u);
  assert.doesNotMatch(wrapper, /useState|useEffect|useRef/u);
  for (const literal of [
    'displayName: "Qoder CLI"',
    'logoSrc: "./qoder-logo.png"',
    'cardClassName: "qoder-availability-card"',
    'primaryActionDataAttribute: "data-qoder-primary"',
    '复制安装指令至 Agent',
    '复制指令粘贴至 Agent',
  ]) assert.match(wrapper, new RegExp(literal, "u"));

  for (const contract of [
    "data-status={availability.status}",
    "data-surface={surface}",
    'aria-live="polite"',
    'aria-atomic="true"',
    "ref={actionButtonRef}",
    "{...primaryActionData}",
    '正在复制…',
  ]) assert.ok(card.includes(contract), contract);
});

test("About keeps its open, return-to-app and action-focus fences", async () => {
  const about = await source("../app/components/AboutPageRootDialog.tsx");
  assert.match(about, /(?:window\.)?requestAnimationFrame/u);
  assert.match(about, /document\.visibilityState === "visible"/u);
  assert.match(about, /window\.addEventListener\("focus"/u);
  assert.match(about, /document\.addEventListener\("visibilitychange"/u);
  assert.match(about, /qoderActionRef\.current\?\.focus\(\)/u);
});
