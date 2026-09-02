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
    '安装 Qoder CLI',
    '复制登录指令',
  ]) assert.match(wrapper, new RegExp(literal, "u"));

  for (const contract of [
    "data-status={availability.status}",
    "data-surface={surface}",
    'aria-live="polite"',
    'aria-atomic="true"',
    "ref={index === 0 ? actionButtonRef : undefined}",
    "{...(index === 0 ? primaryActionData : {})}",
    '正在复制…',
    '正在安装…',
  ]) assert.ok(card.includes(contract), contract);
  assert.match(card, /data-testid="settings-agent-vendor"/u);
  assert.match(card, /API Token/u);
  assert.doesNotMatch(card, /Anthropic/u);
});

test("About is product information while Settings owns Agent checks and update controls", async () => {
  const [about, settings] = await Promise.all([
    source("../app/components/AboutPageRootDialog.tsx"),
    source("../app/components/SettingsPage.tsx"),
  ]);
  assert.match(about, /源码级本地 HTML 编辑器/u);
  assert.doesNotMatch(about, /about-agent-section|Agent|更新|检查更新|Qoder/u);
  assert.match(settings, /AI Agent/u);
  assert.match(settings, /软件更新/u);
  assert.match(settings, /document\.visibilityState === "visible"/u);
  assert.match(settings, /window\.addEventListener\("focus"/u);
  assert.match(settings, /document\.addEventListener\("visibilitychange"/u);
  assert.match(settings, /agentActionRef\.current\?\.focus\(\)/u);
  assert.match(settings, /onCheckForUpdates/u);
  assert.match(settings, /onDownloadUpdate/u);
  assert.match(settings, /onRequestRestart/u);
  assert.match(settings, /if \(!force && \(/u);
  assert.match(settings, /checkInFlightRef\.current/u);
});
