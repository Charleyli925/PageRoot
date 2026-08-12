import { expect, test } from "@playwright/test";

import { generatedReviewBootstrap } from "../../helpers/generated-review-bootstrap.mjs";

const SOURCE_SHA256 = `sha256:${"a".repeat(64)}`;

function sourceBoxSignature(values = {}) {
  return JSON.stringify([
    ["class", values.class ?? null],
    ["height", values.height ?? null],
    ["hidden", values.hidden ?? null],
    ["style", values.style ?? null],
    ["width", values.width ?? null],
  ]);
}

async function installRuntimeProjectionFrame(page, {
  replaceBeforeReady = false,
  withCommentBinding = false,
} = {}) {
  const sharedStyle = "width: 140px; height: 24px";
  const bindings = [
    {
      candidateKey: "runtime-host-1",
      path: [1, 0, 0],
      tagName: "P",
      sourceBoxSignature: sourceBoxSignature({ style: sharedStyle }),
      identityAttributes: [["id", "shared-static-runtime"]],
    },
    {
      candidateKey: "runtime-host-2",
      path: [1, 0, 1],
      tagName: "CANVAS",
      sourceBoxSignature: sourceBoxSignature({ height: "40", width: "120" }),
      identityAttributes: [["id", "runtime-chart-a"]],
    },
    {
      candidateKey: "runtime-host-3",
      path: [1, 0, 2, 0],
      tagName: "DIV",
      sourceBoxSignature: sourceBoxSignature({ style: "width: 160px; height: 30px" }),
      identityAttributes: [["id", "runtime-chart-b"]],
    },
    {
      candidateKey: "runtime-host-4",
      path: [1, 0, 3, 0, 0, 0, 0],
      tagName: "svg",
      sourceBoxSignature: sourceBoxSignature({ height: "30", width: "90" }),
      identityAttributes: [["id", "runtime-svg-in-table"], ["viewBox", "0 0 90 30"]],
    },
  ];
  const commentBindings = withCommentBinding ? [{
    sourceNodeId: "element:1:1:p",
    path: [1, 0, 0],
    tagName: "P",
    sourceBoxSignature: sourceBoxSignature({ style: sharedStyle }),
    identityAttributes: [["id", "shared-static-runtime"]],
    identityText: "静态文本与运行态样式共存",
  }] : [];
  const bootstrap = generatedReviewBootstrap(commentBindings, bindings)
    .replace(/<\/script/giu, "<\\/script");
  const staticFacts = JSON.stringify([{
    id: "static-text",
    type: "text",
    semanticOwnerId: "static-owner",
    geometryOwnerId: "static-owner",
    scope: "text",
    tone: "added",
    textGroup: "static-text",
    summary: "文本调整",
  }]);
  const srcdoc = `<!doctype html>
<html>
  <head>
    <style>html,body{margin:0}section{padding:20px}canvas,div,p,svg{display:block;margin:12px}</style>
    <script>${bootstrap}</script>
  </head>
  <body>
    <section data-pageroot-outline-id="outline-1">
      <p id="shared-static-runtime" style="${sharedStyle}" data-pageroot-review-marker="change-1" data-pageroot-review-projection-facts='${staticFacts}'>静态文本与运行态样式共存</p>
      <canvas id="runtime-chart-a" width="120" height="40"></canvas>
      <div style="display: none"><div id="runtime-chart-b" style="width: 160px; height: 30px"></div></div>
      <table><tr><td><svg id="runtime-svg-in-table" viewBox="0 0 90 30" width="90" height="30"><rect width="90" height="30"></rect></svg></td></tr></table>
    </section>
    <script>
      ${replaceBeforeReady ? `
      const parserOriginalRuntimeTarget = document.querySelector("#runtime-chart-a");
      parserOriginalRuntimeTarget.replaceWith(parserOriginalRuntimeTarget.cloneNode(true));
      ` : ""}
      window.authoredObservedMessages = [];
      addEventListener("message", (event) => {
        window.authoredObservedMessages.push({
          type: event.data?.type || "",
          challenge: event.data?.challenge || "",
          candidateKey: event.data?.markers?.[0]?.candidateKey || "",
          portCount: event.ports?.length || 0,
        });
      }, { capture: true });
      const forgedChannel = new MessageChannel();
      parent.postMessage({
        source: "pageroot-ai-review",
        contractVersion: 1,
        sessionId: "review-session",
        side: "before",
        sourceSha256: "${SOURCE_SHA256}",
        type: "runtime-projection-channel",
        challenge: "0".repeat(32),
      }, "*", [forgedChannel.port2]);
    </script>
  </body>
</html>`;

  await page.setContent('<iframe id="review-frame" sandbox="allow-scripts"></iframe>');
  await page.evaluate(({ source }) => {
    const frame = document.querySelector("#review-frame");
    window.runtimeProjectionTest = {
      challenge: "b".repeat(32),
      commentChallenge: "c".repeat(32),
      forgedResponses: 0,
      port: null,
      commentPort: null,
      commentLayouts: [],
      ready: false,
    };
    addEventListener("message", (event) => {
      const message = event.data;
      if (event.source !== frame.contentWindow) return;
      const state = window.runtimeProjectionTest;
      if (message?.type === "ready") {
        state.ready = true;
        return;
      }
      if (message?.type === "comment-layout") {
        state.commentLayouts.push(...(message.commentLayouts || []));
        return;
      }
      if (message?.type === "review-comment-channel") {
        const port = event.ports?.length === 1 ? event.ports[0] : null;
        if (
          message.source === "pageroot-ai-review"
          && message.sessionId === "review-session"
          && message.side === "before"
          && message.challenge === state.commentChallenge
          && port
          && !state.commentPort
        ) {
          state.commentPort = port;
          port.start();
        } else {
          port?.close();
        }
        return;
      }
      if (message?.type !== "runtime-projection-channel") return;
      const port = event.ports?.length === 1 ? event.ports[0] : null;
      if (
        message.source === "pageroot-ai-review"
        && message.contractVersion === 1
        && message.sessionId === "review-session"
        && message.side === "before"
        && message.sourceSha256 === `sha256:${"a".repeat(64)}`
        && message.challenge === state.challenge
        && port
        && !state.port
      ) {
        state.port = port;
        port.start();
      } else {
        state.forgedResponses += 1;
        port?.close();
      }
    });
    frame.srcdoc = source;
  }, { source: srcdoc });

  await expect.poll(() => page.evaluate(() => window.runtimeProjectionTest.ready)).toBe(true);
  await page.evaluate(({ sourceSha256, requestCommentChannel }) => {
    const frame = document.querySelector("#review-frame");
    const state = window.runtimeProjectionTest;
    if (requestCommentChannel) {
      frame.contentWindow.postMessage({
        source: "pageroot-ai-review-parent",
        sessionId: "review-session",
        type: "request-review-comment-channel",
        challenge: state.commentChallenge,
      }, "*");
    }
    frame.contentWindow.postMessage({
      source: "pageroot-ai-review-parent",
      contractVersion: 1,
      sessionId: "review-session",
      side: "before",
      sourceSha256,
      type: "request-runtime-projection-channel",
      challenge: state.challenge,
    }, "*");
  }, { sourceSha256: SOURCE_SHA256, requestCommentChannel: withCommentBinding });
  await expect.poll(() => page.evaluate(() => Boolean(window.runtimeProjectionTest.port))).toBe(true);
  if (withCommentBinding) {
    await expect.poll(() => page.evaluate(() => (
      Boolean(window.runtimeProjectionTest.commentPort)
    ))).toBe(true);
  }
  return page.frameLocator("#review-frame");
}

async function postRuntimeFacts(page, markers, overrides = {}) {
  await page.evaluate(({ projectionMarkers, sourceSha256, messageOverrides }) => {
    const port = window.runtimeProjectionTest.port;
    port.postMessage({
      source: "pageroot-ai-review-runtime-projection",
      contractVersion: 1,
      sessionId: "review-session",
      side: "before",
      sourceSha256,
      type: "runtime-projection-facts",
      markers: projectionMarkers,
      ...messageOverrides,
    });
    port.close();
  }, {
    projectionMarkers: markers,
    sourceSha256: SOURCE_SHA256,
    messageOverrides: overrides,
  });
}

async function postCommentTargets(page) {
  await page.evaluate(() => {
    window.runtimeProjectionTest.commentPort.postMessage({
      source: "pageroot-ai-review-comment-targets",
      sessionId: "review-session",
      side: "before",
      type: "comment-targets",
      reviewCommentTargets: [{
        key: "comment-1",
        selector: "#shared-static-runtime",
        sourceNodeId: "element:1:1:p",
      }],
    });
  });
}

async function postReviewState(page, filter = "all") {
  await page.evaluate(({ reviewFilter }) => {
    document.querySelector("#review-frame").contentWindow.postMessage({
      source: "pageroot-ai-review-parent",
      sessionId: "review-session",
      type: "state",
      state: { filter: reviewFilter, focus: "all", transparency: 18, scale: 1 },
    }, "*");
  }, { reviewFilter: filter });
}

test("runtime projection binds exact hosts and adds facts without outline geometry", async ({ page }) => {
  const frame = await installRuntimeProjectionFrame(page);
  await postRuntimeFacts(page, [
    { candidateKey: "runtime-host-1", changeId: "change-1" },
    { candidateKey: "runtime-host-2", changeId: "change-1" },
    { candidateKey: "runtime-host-3", changeId: "change-1" },
    { candidateKey: "runtime-host-4", changeId: "change-1" },
  ]);

  const sharedRuntimeBox = frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact="style:runtime-projection-1"]',
  );
  const canvasRuntimeBox = frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact="style:runtime-projection-2"]',
  );
  const hiddenRuntimeBox = frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact="style:runtime-projection-3"]',
  );
  const svgRuntimeBox = frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact="style:runtime-projection-4"]',
  );
  const staticTextBox = frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact="text:static-text"]',
  );
  await expect(sharedRuntimeBox).toHaveCount(1);
  await expect(canvasRuntimeBox).toHaveCount(1);
  await expect(hiddenRuntimeBox).toHaveCount(0);
  await expect(svgRuntimeBox).toHaveCount(1);
  await expect.poll(() => staticTextBox.count()).toBeGreaterThan(0);
  await expect(frame.locator("section[data-pageroot-outline-id='outline-1']"))
    .not.toHaveAttribute("data-pageroot-review-runtime-marker", "true");
  await expect(frame.locator(
    "[data-pageroot-review-runtime-marker], [data-pageroot-review-runtime-source-box]",
  )).toHaveCount(0);

  await expect.poll(() => canvasRuntimeBox.evaluate((overlay) => {
    const target = document.querySelector("#runtime-chart-a");
    const targetRect = target.getBoundingClientRect();
    return Math.abs(Number(overlay.getAttribute("data-left")) - (targetRect.left - 3)) < 0.2
      && Math.abs(Number(overlay.getAttribute("data-top")) - (targetRect.top - 3)) < 0.2
      && Math.abs(Number(overlay.getAttribute("data-width")) - (targetRect.width + 6)) < 0.2;
  })).toBe(true);
  await expect.poll(() => svgRuntimeBox.evaluate((overlay) => {
    const target = document.querySelector("#runtime-svg-in-table");
    const targetRect = target.getBoundingClientRect();
    return target.namespaceURI === "http://www.w3.org/2000/svg"
      && target.parentElement.parentElement.parentElement.tagName === "TBODY"
      && Math.abs(Number(overlay.getAttribute("data-left")) - (targetRect.left - 3)) < 0.2
      && Math.abs(Number(overlay.getAttribute("data-top")) - (targetRect.top - 3)) < 0.2
      && Math.abs(Number(overlay.getAttribute("data-width")) - (targetRect.width + 6)) < 0.2
      && Math.abs(Number(overlay.getAttribute("data-height")) - (targetRect.height + 6)) < 0.2;
  })).toBe(true);

  await postReviewState(page, "text");
  await expect.poll(() => staticTextBox.count()).toBeGreaterThan(0);
  await expect(sharedRuntimeBox).toHaveCount(0);
  await expect(canvasRuntimeBox).toHaveCount(0);
  await expect(svgRuntimeBox).toHaveCount(0);
  await postReviewState(page, "style");
  await expect(sharedRuntimeBox).toHaveCount(1);
  await expect(canvasRuntimeBox).toHaveCount(1);
  await expect(svgRuntimeBox).toHaveCount(1);

  await page.evaluate(() => {
    document.querySelector("#review-frame").contentWindow.postMessage({
      source: "pageroot-ai-review-parent",
      sessionId: "review-session",
      type: "runtime-projection-facts",
      markers: [],
    }, "*");
  });
  await expect(canvasRuntimeBox).toHaveCount(1);

  await frame.locator("#runtime-chart-b").evaluate((element) => {
    element.parentElement.style.display = "block";
  });
  await postReviewState(page, "style");
  await expect(hiddenRuntimeBox).toHaveCount(1);

  await frame.locator("#runtime-chart-a").evaluate((element) => {
    element.replaceWith(element.cloneNode(true));
  });
  await postReviewState(page, "style");
  await expect(canvasRuntimeBox).toHaveCount(0);

  await frame.locator("#shared-static-runtime").evaluate((element) => {
    element.style.width = "141px";
  });
  await postReviewState(page, "all");
  await expect(sharedRuntimeBox).toHaveCount(0);
  await expect.poll(() => staticTextBox.count()).toBeGreaterThan(0);
});

test("hostile authored listeners cannot observe or forge runtime projection capability", async ({ page }) => {
  const frame = await installRuntimeProjectionFrame(page);
  await expect.poll(() => page.evaluate(() => window.runtimeProjectionTest.forgedResponses))
    .toBe(1);
  const observed = await frame.locator("html").evaluate(() => window.authoredObservedMessages);
  expect(observed.some((message) => (
    message.type === "request-runtime-projection-channel"
    || message.challenge === "b".repeat(32)
    || message.portCount > 0
  ))).toBe(false);

  await postRuntimeFacts(page, [{ candidateKey: "runtime-host-2", changeId: "change-1" }]);
  await expect(frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact="style:runtime-projection-1"]',
  )).toHaveCount(1);
  const leaked = await frame.locator("html").evaluate(() => ({
    authoredMessages: window.authoredObservedMessages,
    attributes: [...document.querySelectorAll("*")].flatMap((element) => (
      [...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)
    )),
  }));
  expect(JSON.stringify(leaked)).not.toContain("runtime-host-2");
});

test("comment and runtime bindings keep separate ports in the same first bootstrap", async ({ page }) => {
  const frame = await installRuntimeProjectionFrame(page, { withCommentBinding: true });
  expect(await page.evaluate(() => (
    window.runtimeProjectionTest.commentPort !== window.runtimeProjectionTest.port
  ))).toBe(true);

  await postCommentTargets(page);
  await postRuntimeFacts(page, [{ candidateKey: "runtime-host-2", changeId: "change-1" }]);

  await expect.poll(() => page.evaluate(() => (
    window.runtimeProjectionTest.commentLayouts.some((layout) => layout.key === "comment-1")
  ))).toBe(true);
  await expect(frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact="style:runtime-projection-1"]',
  )).toHaveCount(1);
  const observed = await frame.locator("html").evaluate(() => window.authoredObservedMessages);
  expect(observed.some((message) => (
    message.type === "request-review-comment-channel"
    || message.type === "request-runtime-projection-channel"
    || message.challenge === "b".repeat(32)
    || message.challenge === "c".repeat(32)
    || message.portCount > 0
  ))).toBe(false);
});

test("empty runtime projection preserves static facts", async ({ page }) => {
  const frame = await installRuntimeProjectionFrame(page);
  const staticTextBox = frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact="text:static-text"]',
  );
  await expect.poll(() => staticTextBox.count()).toBeGreaterThan(0);
  await postRuntimeFacts(page, []);
  await expect.poll(() => staticTextBox.count()).toBeGreaterThan(0);
  await expect(frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact^="style:runtime-projection-"]',
  )).toHaveCount(0);
});

test("cross-session side and source runtime results preserve static facts", async ({ page }) => {
  const invalidEnvelopes = [
    { sessionId: "review-session-stale" },
    { side: "after" },
    { sourceSha256: `sha256:${"d".repeat(64)}` },
  ];
  for (const invalidEnvelope of invalidEnvelopes) {
    const frame = await installRuntimeProjectionFrame(page);
    const staticTextBox = frame.locator(
      '[data-pageroot-review-overlay-box][data-pageroot-review-fact="text:static-text"]',
    );
    await expect.poll(() => staticTextBox.count()).toBeGreaterThan(0);
    await postRuntimeFacts(
      page,
      [{ candidateKey: "runtime-host-2", changeId: "change-1" }],
      invalidEnvelope,
    );
    await expect.poll(() => staticTextBox.count()).toBeGreaterThan(0);
    await expect(frame.locator(
      '[data-pageroot-review-overlay-box][data-pageroot-review-fact^="style:runtime-projection-"]',
    )).toHaveCount(0);
  }
});

test("parser-time target replacement fails closed without rebinding", async ({ page }) => {
  const frame = await installRuntimeProjectionFrame(page, { replaceBeforeReady: true });
  await postRuntimeFacts(page, [{ candidateKey: "runtime-host-2", changeId: "change-1" }]);
  await expect(frame.locator(
    '[data-pageroot-review-overlay-box][data-pageroot-review-fact^="style:runtime-projection-"]',
  )).toHaveCount(0);
});
