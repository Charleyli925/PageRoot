import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generatedReviewBootstrap } from "../../helpers/generated-review-bootstrap.mjs";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
  sourceSha256,
} from "../../../app/lib/source-index.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const RUNTIME_HOST_SOURCE = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
  <div id="runtime-host"></div>
</body></html>`;
const RUNTIME_PNG_BYTES = Object.freeze([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240,
  31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69,
  78, 68, 174, 66, 96, 130,
]);
let runtimeProjectionBundlePromise;

async function runtimeProjectionBundle() {
  runtimeProjectionBundlePromise ??= build({
    entryPoints: [path.join(
      productRoot,
      "app/components/html-canvas-runtime-visual.ts",
    )],
    bundle: true,
    format: "iife",
    globalName: "PageRootRuntimeVisualTest",
    logLevel: "silent",
    platform: "browser",
    target: "es2022",
    write: false,
  }).then((result) => result.outputFiles[0]?.text || "");
  const bundle = await runtimeProjectionBundlePromise;
  if (!bundle) throw new Error("Runtime visual projection test bundle is empty.");
  return bundle;
}

function runtimeHostSourceNodeId() {
  const sourceIndex = buildSourceIndex(RUNTIME_HOST_SOURCE);
  const host = sourceIndex.elements.find((element) => (
    element.tagName === "div"
    && element.stableAttributes.id === "runtime-host"
  ));
  if (!host) throw new Error("Runtime visual test host was not indexed.");
  return host.nodeId;
}

function runtimeHostProjection(sourceNodeId, pngSha256) {
  return {
    sourceSha256: sourceSha256(RUNTIME_HOST_SOURCE),
    visuals: [{
      captureKey: "runtime-host",
      height: 1,
      kind: "host",
      pngBytes: [...RUNTIME_PNG_BYTES],
      pngSha256,
      sourceNodeId,
      tagName: "div",
      width: 1,
    }],
  };
}

async function installDeferredRuntimeProjectionHarness(page) {
  const sourceNodeId = runtimeHostSourceNodeId();
  await page.setContent(RUNTIME_HOST_SOURCE);
  await page.addScriptTag({ content: await runtimeProjectionBundle() });
  await page.evaluate(({ sourceNodeAttribute, sourceNodeId: nodeId }) => {
    const host = document.querySelector("#runtime-host");
    if (!host) throw new Error("Runtime visual test host is missing.");
    host.setAttribute(sourceNodeAttribute, nodeId);

    const originalSrc = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "src",
    );
    if (!originalSrc) throw new Error("Image src descriptor is unavailable.");
    const sourceByImage = new WeakMap();
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: originalSrc.enumerable,
      get() {
        return sourceByImage.get(this) || "";
      },
      set(value) {
        sourceByImage.set(this, String(value));
      },
    });

    const deferred = [];
    HTMLImageElement.prototype.decode = function deferredDecode() {
      return new Promise((resolve, reject) => {
        deferred.push({ image: this, reject, resolve });
      });
    };
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__ = {
      deferredCount: () => deferred.length,
      resolve(index) {
        const pending = deferred[index];
        if (!pending) throw new Error(`Missing deferred image ${index}.`);
        pending.resolve();
      },
    };
  }, { sourceNodeAttribute: SOURCE_NODE_ATTRIBUTE, sourceNodeId });
  return { sourceNodeId };
}

const COMMENT_SOURCE_BOX_SIGNATURE = JSON.stringify([
  ["class", "comment-host"],
  ["height", null],
  ["hidden", null],
  ["style", null],
  ["width", null],
]);

const COMMENT_OTHER_SOURCE_BOX_SIGNATURE = JSON.stringify([
  ["class", "comment-other"],
  ["height", null],
  ["hidden", null],
  ["style", null],
  ["width", null],
]);

async function parsedReviewCommentLayouts(page, {
  binding,
  bindings = binding ? [binding] : [],
  authoredScript,
}) {
  const commentBindings = bindings;
  const commentTargets = commentBindings.map((commentBinding, index) => ({
    key: commentBindings.length === 1
      ? "parsed-comment"
      : `parsed-comment-${index + 1}`,
    selector: ".comment-host",
    sourceNodeId: commentBinding.sourceNodeId,
  }));
  const bootstrap = generatedReviewBootstrap(commentBindings);
  await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; }
      main { display: block; }
      .comment-host { display: block; width: 10px; height: 10px; }
      .comment-other { display: block; width: 10px; height: 10px; }
    </style>
    <script>${bootstrap}</script>
  </head>
  <body>
    <main></main>
    <script>${authoredScript}</script>
  </body>
</html>`, { waitUntil: "load" });
  return page.evaluate(async ({ sessionId, side, commentTargets }) => {
    const messages = [];
    let commentPort = null;
    const receive = (event) => {
      const message = event.data;
      if (
        message?.source === "pageroot-ai-review"
        && message.type === "review-comment-channel"
      ) {
        commentPort = event.ports?.[0] || null;
        commentPort?.start?.();
      }
      if (
        message?.source === "pageroot-ai-review"
        && message.type === "comment-layout"
      ) messages.push(message);
    };
    addEventListener("message", receive);
    try {
      const challenge = "a".repeat(32);
      postMessage({
        source: "pageroot-ai-review-parent",
        sessionId,
        type: "request-review-comment-channel",
        challenge,
      }, "*");
      const deadline = Date.now() + 3_000;
      while (!commentPort && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!commentPort) return { channel: false, layouts: messages };
      const expectedCommentKeys = new Set(commentTargets.map(({ key }) => key));
      commentPort.postMessage({
        source: "pageroot-ai-review-comment-targets",
        sessionId,
        side,
        type: "comment-targets",
        reviewCommentTargets: commentTargets,
      });
      while (
        !messages.some((message) => (
          message.commentLayouts?.some((layout) => expectedCommentKeys.has(layout.key))
        ))
        && Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return { channel: true, layouts: messages };
    } finally {
      removeEventListener("message", receive);
    }
  }, { sessionId: "review-session", side: "before", commentTargets });
}

test("path-only review comments bind against a real parsed DOM", async ({ page }) => {
  const binding = {
    sourceNodeId: "element:1:1:div",
    path: [1, 0, 0],
    tagName: "DIV",
    sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
    identityText: "",
  };
  const result = await parsedReviewCommentLayouts(page, {
    binding,
    authoredScript: `
      const host = document.createElement("div");
      host.className = "comment-host";
      document.querySelector("main").append(host);
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    message.commentLayouts?.some((layout) => layout.key === "parsed-comment")
  ))).toBe(true);
});

test("source-backed comment IDs survive an authored RegExp exec mutation", async ({ page }) => {
  const binding = {
    sourceNodeId: "element:1:1:div",
    path: [1, 0, 0],
    tagName: "DIV",
    sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
    identityText: "",
  };
  const result = await parsedReviewCommentLayouts(page, {
    binding,
    authoredScript: `
      RegExp.prototype.exec = () => null;
      const host = document.createElement("div");
      host.className = "comment-host";
      document.querySelector("main").append(host);
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    message.commentLayouts?.some((layout) => layout.key === "parsed-comment")
  ))).toBe(true);
});

test("runtime visual keys survive an authored String replace mutation", async ({ page }) => {
  const binding = {
    sourceNodeId: "element:1:1:div",
    path: [1, 0, 0],
    tagName: "DIV",
    sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
    identityText: "",
  };
  const result = await parsedReviewCommentLayouts(page, {
    binding,
    authoredScript: `
      String.prototype.replace = () => "";
      const host = document.createElement("div");
      host.className = "comment-host";
      document.querySelector("main").append(host);
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    message.commentLayouts?.some((layout) => layout.key === "parsed-comment")
  ))).toBe(true);
});

test("path-only review comments fail closed when the parsed path and tag diverge", async ({ page }) => {
  const binding = {
    sourceNodeId: "element:1:1:div",
    path: [1, 0, 0],
    tagName: "DIV",
    sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
    identityText: "",
  };
  const result = await parsedReviewCommentLayouts(page, {
    binding,
    authoredScript: `
      const wrongPath = document.createElement("section");
      wrongPath.className = "comment-host";
      const main = document.querySelector("main");
      main.append(wrongPath);
      const actualTarget = document.createElement("div");
      actualTarget.className = "comment-host";
      main.append(actualTarget);
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    message.commentLayouts?.some((layout) => layout.key === "parsed-comment")
  ))).toBe(false);
});

test("path-only review comments fail closed when a same-tag parser decoy shifts the target", async ({ page }) => {
  const binding = {
    sourceNodeId: "element:1:1:div",
    path: [1, 0, 0],
    tagName: "DIV",
    sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
    identityText: "",
  };
  const result = await parsedReviewCommentLayouts(page, {
    binding,
    authoredScript: `
      const main = document.querySelector("main");
      const decoy = document.createElement("div");
      decoy.className = "comment-host";
      main.append(decoy);
      const actualTarget = document.createElement("div");
      actualTarget.className = "comment-host";
      main.append(actualTarget);
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    message.commentLayouts?.some((layout) => layout.key === "parsed-comment")
  ))).toBe(false);
});

test("path-only review comments keep a bound target when a later same-tag node is unrelated", async ({ page }) => {
  const binding = {
    sourceNodeId: "element:1:1:div",
    path: [1, 0, 0],
    tagName: "DIV",
    sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
    identityText: "",
  };
  const result = await parsedReviewCommentLayouts(page, {
    binding,
    authoredScript: `
      const main = document.querySelector("main");
      const actualTarget = document.createElement("div");
      actualTarget.className = "comment-host";
      main.append(actualTarget);
      main.append(document.createElement("div"));
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    message.commentLayouts?.some((layout) => layout.key === "parsed-comment")
  ))).toBe(true);
});

test("identical path-only comment siblings keep their separate frozen paths", async ({ page }) => {
  const bindings = [0, 1].map((index) => ({
    sourceNodeId: `element:1:${index + 1}:div`,
    path: [1, 0, index],
    tagName: "DIV",
    sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
    identityText: "",
  }));
  const result = await parsedReviewCommentLayouts(page, {
    bindings,
    authoredScript: `
      const main = document.querySelector("main");
      for (let index = 0; index < 2; index += 1) {
        const actual = document.createElement("div");
        actual.className = "comment-host";
        main.append(actual);
      }
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    new Set(message.commentLayouts?.map((layout) => layout.key) || [])
      .has("parsed-comment-1")
    && new Set(message.commentLayouts?.map((layout) => layout.key) || [])
      .has("parsed-comment-2")
  ))).toBe(true);
});

test("mixed-shape path-only comment decoys fail closed", async ({ page }) => {
  const bindings = [
    {
      sourceNodeId: "element:1:1:div",
      path: [1, 0, 0],
      tagName: "DIV",
      sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
      identityAttributes: [],
      identityText: "",
    },
    {
      sourceNodeId: "element:1:2:div",
      path: [1, 0, 1],
      tagName: "DIV",
      sourceBoxSignature: COMMENT_OTHER_SOURCE_BOX_SIGNATURE,
      identityAttributes: [],
      identityText: "",
    },
  ];
  const result = await parsedReviewCommentLayouts(page, {
    bindings,
    authoredScript: `
      const main = document.querySelector("main");
      const decoy = document.createElement("div");
      decoy.className = "comment-host";
      main.append(decoy);
      const actualFirst = document.createElement("div");
      actualFirst.className = "comment-host";
      main.append(actualFirst);
      const actualSecond = document.createElement("div");
      actualSecond.className = "comment-other";
      main.append(actualSecond);
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    message.commentLayouts?.some((layout) => layout.key.startsWith("parsed-comment-"))
  ))).toBe(false);
});

test("runtime host projection keeps a newer pending bitmap when an old decode settles", async ({ page }) => {
  const { sourceNodeId } = await installDeferredRuntimeProjectionHarness(page);
  const first = runtimeHostProjection(sourceNodeId, "sha256:runtime-first");
  const second = runtimeHostProjection(sourceNodeId, "sha256:runtime-second");
  await page.evaluate(({ first: initial, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      initial,
    );
  }, { first, source: RUNTIME_HOST_SOURCE });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.deferredCount()
  ))).toBe(1);

  await page.evaluate(({ next, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      next,
    );
  }, { next: second, source: RUNTIME_HOST_SOURCE });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.deferredCount()
  ))).toBe(2);

  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
  });
  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
  });

  await expect(page.locator(
    '#runtime-host img[data-pageroot-readonly-visual="runtime-bitmap"]',
  )).toHaveAttribute("data-pageroot-readonly-visual-sha", "sha256:runtime-second");
});

test("runtime host projection cancels a pending bitmap before it can mount after cleanup", async ({ page }) => {
  const { sourceNodeId } = await installDeferredRuntimeProjectionHarness(page);
  const projection = runtimeHostProjection(sourceNodeId, "sha256:runtime-pending");
  await page.evaluate(({ projection: next, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      next,
    );
  }, { projection, source: RUNTIME_HOST_SOURCE });
  await expect(page.locator("#runtime-host")).toHaveAttribute(
    "data-pageroot-readonly-visual-host",
    "runtime-bitmap",
  );
  await page.evaluate(() => {
    window.PageRootRuntimeVisualTest.restoreRuntimeVisualProjection(document);
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(0);
  });
  await expect.poll(() => page.locator(
    '#runtime-host img[data-pageroot-readonly-visual="runtime-bitmap"]',
  ).count()).toBe(0);
  await expect(page.locator("#runtime-host")).not.toHaveAttribute(
    "data-pageroot-readonly-visual-host",
  );
});
