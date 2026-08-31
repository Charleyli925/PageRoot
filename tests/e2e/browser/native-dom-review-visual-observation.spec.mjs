import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { generatedReviewBootstrap } from "../../helpers/generated-review-bootstrap.mjs";

const HOST_ID = "pr1_11111111111141118111111111111111";

async function observe(page, {
  body = `<main data-pageroot-id="${HOST_ID}">same</main>`,
  authoredScript = "",
  readySelector = "",
  present = true,
  side = "after",
} = {}) {
  const bootstrap = generatedReviewBootstrap([], side, [HOST_ID]);
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0}</style><script>${bootstrap}</script></head><body>${body}<script>${authoredScript}</script></body></html>`, {
    waitUntil: "load",
  });
  if (readySelector) await page.locator(readySelector).waitFor({ state: "attached" });
  return page.evaluate(async ({ side, stableId, present }) => {
    let port = null;
    const receive = (event) => {
      if (event.data?.type === "review-visual-channel") port = event.ports?.[0] || null;
    };
    addEventListener("message", receive);
    try {
      postMessage({
        source: "pageroot-ai-review-parent",
        sessionId: "review-session",
        type: "request-review-visual-channel",
        challenge: "c".repeat(32),
      }, "*");
      const deadline = Date.now() + 3_000;
      while (!port && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!port) throw new Error("visual capability port did not arrive");
      return await new Promise((resolve) => {
        port.onmessage = (event) => resolve(event.data.observations[0]);
        port.postMessage({
          type: "observe",
          sessionId: "review-session",
          side,
          sourceHash: `sha256:${side}`,
          generation: 7,
          candidates: [{ stableId, present }],
        });
      });
    } finally {
      removeEventListener("message", receive);
    }
  }, { side, stableId: HOST_ID, present });
}

test("visual summaries ignore page position and class source noise but detect presentation", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async ({ page }) => {
  const baseline = await observe(page, {
    body: `<main style="margin-left:0"><p data-pageroot-id="${HOST_ID}" class="old">same</p></main>`,
  });
  const shifted = await observe(page, {
    body: `<main style="transform:translate(.5px,120px)"><p data-pageroot-id="${HOST_ID}" class="new">same</p></main>`,
  });
  expect(baseline.unverified).not.toBe(true);
  expect(shifted.unverified).not.toBe(true);
  expect(shifted.fingerprint).toBe(baseline.fingerprint);

  const recolored = await observe(page, {
    body: `<p data-pageroot-id="${HOST_ID}" style="color:rgb(200,0,0)">same</p>`,
  });
  expect(recolored.fingerprint).not.toBe(baseline.fingerprint);
});

test("visual summaries cover text, runtime DOM, SVG and Canvas drawing surfaces", async ({ page }) => {
  const text = await observe(page, { body: `<p data-pageroot-id="${HOST_ID}">changed</p>` });
  const contentsBefore = await observe(page, {
    body: `<p data-pageroot-id="${HOST_ID}">stable <span style="display:contents">old</span></p>`,
  });
  const contentsAfter = await observe(page, {
    body: `<p data-pageroot-id="${HOST_ID}">stable <span style="display:contents">new</span></p>`,
  });
  const runtime = await observe(page, {
    body: `<main data-pageroot-id="${HOST_ID}"></main>`,
    authoredScript: "document.querySelector('main').append(Object.assign(document.createElement('strong'), { textContent: 'runtime' }))",
  });
  const svg = await observe(page, {
    body: `<svg data-pageroot-id="${HOST_ID}" width="80" height="40"><path d="M0 0 L70 30" stroke="red"/></svg>`,
  });
  const canvas = await observe(page, {
    body: `<canvas data-pageroot-id="${HOST_ID}" width="80" height="40"></canvas>`,
    authoredScript: "const c=document.querySelector('canvas').getContext('2d');c.fillStyle='blue';c.fillRect(4,4,30,20);c.fillText('42',40,20)",
  });
  for (const result of [text, runtime, svg, canvas]) {
    expect(result.visible).toBe(true);
    expect(result.unverified).not.toBe(true);
    expect(result.fingerprint).toMatch(/^\d+:\d+$/u);
  }
  expect(new Set([text.fingerprint, runtime.fingerprint, svg.fingerprint, canvas.fingerprint]).size)
    .toBe(4);
  expect(contentsAfter.fingerprint).not.toBe(contentsBefore.fingerprint);
});

test("a forged replacement carrying the same Stable ID fails closed", async ({ page }) => {
  const replaced = await observe(page, {
    body: `<main data-pageroot-id="${HOST_ID}">source host</main>`,
    authoredScript: `
      const sourceHost = document.querySelector('[data-pageroot-id="${HOST_ID}"]');
      const replacement = document.createElement('main');
      replacement.setAttribute('data-pageroot-id', '${HOST_ID}');
      replacement.textContent = 'forged host';
      sourceHost.removeAttribute('data-pageroot-id');
      sourceHost.replaceWith(replacement);
    `,
  });
  expect(replaced).toMatchObject({
    unverified: true,
    failureReason: "missing-runtime-host",
  });
});

test("image content and visibility use rendered evidence rather than source URL alone", async ({ page }) => {
  const svgImage = (color, padding = "") => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">${padding}<rect width="8" height="8" fill="${color}"/></svg>`)}`;
  const red = await observe(page, {
    body: `<img data-pageroot-id="${HOST_ID}" src="${svgImage("red")}">`,
  });
  const sameRedDifferentBytes = await observe(page, {
    body: `<img data-pageroot-id="${HOST_ID}" src="${svgImage("red", " ")}">`,
  });
  const blue = await observe(page, {
    body: `<img data-pageroot-id="${HOST_ID}" src="${svgImage("blue")}">`,
  });
  const hidden = await observe(page, {
    body: `<p data-pageroot-id="${HOST_ID}" style="display:none">hidden</p>`,
  });
  expect(red.fingerprint).toBe(sameRedDifferentBytes.fingerprint);
  expect(blue.fingerprint).not.toBe(red.fingerprint);
  expect(hidden).toMatchObject({ visible: false });
  expect(hidden.unverified).not.toBe(true);
});

test("unsupported animated, media, WebGL and over-budget surfaces fail closed", async ({ page }) => {
  const animated = await observe(page, {
    body: `<style>@keyframes pulse{to{opacity:.4}}</style><main data-pageroot-id="${HOST_ID}" style="animation:pulse 1s infinite">moving</main>`,
  });
  const media = await observe(page, {
    body: `<main data-pageroot-id="${HOST_ID}"><video></video></main>`,
  });
  const webgl = await observe(page, {
    body: `<canvas data-pageroot-id="${HOST_ID}" width="20" height="20"></canvas>`,
    authoredScript: "document.querySelector('canvas').getContext('webgl')",
  });
  const overBudget = await observe(page, {
    body: `<canvas data-pageroot-id="${HOST_ID}" width="2100" height="2100"></canvas>`,
  });
  expect(animated).toMatchObject({ unverified: true, failureReason: "animation" });
  expect(media).toMatchObject({ unverified: true, failureReason: "live-media" });
  expect(webgl).toMatchObject({ unverified: true, failureReason: "webgl-or-unreadable-canvas" });
  expect(overBudget).toMatchObject({ unverified: true, failureReason: "pixel-budget" });
});

test("a genuinely tainted Canvas proves the unreadable branch", async ({ page }) => {
  const image = readFileSync(new URL("../../../public/favicon.png", import.meta.url));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(image);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const result = await observe(page, {
      body: `<canvas data-pageroot-id="${HOST_ID}" width="64" height="64"></canvas>`,
      authoredScript: `
        const image = new Image();
        image.src = 'http://127.0.0.1:${address.port}/favicon.png';
        image.onload = () => {
          const canvas = document.querySelector('canvas');
          canvas.getContext('2d').drawImage(image,0,0,32,32);
          canvas.dataset.taintedReady = 'true';
        };
      `,
      readySelector: '[data-tainted-ready="true"]',
    });
    expect(result).toMatchObject({ unverified: true, failureReason: "tainted-canvas" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("pending projection stays clear and a trusted verdict activates existing text UI", {
  tag: ["@gate-smoke", "@smoke-review"],
}, async ({ page }) => {
  const bootstrap = generatedReviewBootstrap([], "after", [HOST_ID]);
  await page.setContent(`<!doctype html><script>${bootstrap}</script><p data-pageroot-id="${HOST_ID}"><span data-pageroot-review-text="added" data-pageroot-review-marker="change-1" data-pageroot-review-marker-types="text" data-pageroot-review-summary="新增内容">new</span></p>`);
  await expect(page.locator("[data-pageroot-review-projection-layer]")).toHaveCount(0);
  const activated = await page.evaluate(async ({ stableId }) => {
    let port = null;
    addEventListener("message", (event) => {
      if (event.data?.type === "review-visual-channel") port = event.ports?.[0] || null;
    }, { once: true });
    postMessage({ source: "pageroot-ai-review-parent", sessionId: "review-session", type: "request-review-visual-channel", challenge: "d".repeat(32) }, "*");
    const deadline = Date.now() + 3_000;
    while (!port && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    port.postMessage({
      type: "verdicts",
      sessionId: "review-session",
      side: "after",
      changed: [{ id: "change-1", stableId, types: ["text"] }],
    });
    window.__reviewTestVisualPort = port;
    port.postMessage({
      type: "comment-highlight",
      sessionId: "review-session",
      side: "after",
      active: true,
      stableIds: [stableId],
    });
    return Boolean(port);
  }, { stableId: HOST_ID });
  expect(activated).toBe(true);
  await expect(page.locator('[data-pageroot-review-overlay-box="change-1"]')).toHaveCount(1);
  await expect(page.locator('[data-pageroot-review-text-mark="added"]')).not.toHaveCount(0);
  await expect(page.locator("[data-pageroot-review-mask-dim]")).toHaveCount(1);
  await expect(page.locator("[data-pageroot-review-comment-highlight]")).toHaveCount(1);
  await page.evaluate(() => window.__reviewTestVisualPort.postMessage({
    type: "comment-highlight",
    sessionId: "review-session",
    side: "after",
    active: false,
    stableIds: [],
  }));
  await expect(page.locator("[data-pageroot-review-comment-highlight]")).toHaveCount(0);
});
