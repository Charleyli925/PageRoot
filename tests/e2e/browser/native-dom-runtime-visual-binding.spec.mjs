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
const RUNTIME_DIRECT_SOURCE = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
  <canvas id="runtime-direct" width="30" height="15" style="background-image:linear-gradient(red, blue);background-size:contain;width:30px;height:15px"></canvas>
</body></html>`;
const RUNTIME_TRANSFORMED_DIRECT_SOURCE = `<!doctype html>
<html><head><meta charset="utf-8"></head><body style="margin:0">
  <main style="transform:scale(2);transform-origin:top left">
    <canvas id="runtime-transformed-direct" width="100" height="50" style="display:block;width:100px;height:50px;transform:scale(1.5, 2);transform-origin:top left"></canvas>
  </main>
</body></html>`;
const RUNTIME_ZOOMED_DIRECT_SOURCE = `<!doctype html>
<html><head><meta charset="utf-8"></head><body style="margin:0">
  <main style="zoom:2">
    <canvas id="runtime-zoomed-direct" width="120" height="60" style="display:block;width:120px;height:60px"></canvas>
  </main>
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

function runtimeSourceNodeId(source, id, tagName) {
  const sourceIndex = buildSourceIndex(source);
  const host = sourceIndex.elements.find((element) => (
    element.tagName === tagName
    && element.stableAttributes.id === id
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
      layoutWidth: 1,
      layoutHeight: 1,
    }],
  };
}

function runtimeDirectProjection(source, sourceNodeId, pngSha256, {
  layoutWidth = 640,
  layoutHeight = 320,
} = {}) {
  return {
    sourceSha256: sourceSha256(source),
    visuals: [{
      captureKey: "runtime-direct",
      height: 1,
      kind: "canvas",
      pngBytes: [...RUNTIME_PNG_BYTES],
      pngSha256,
      sourceNodeId,
      tagName: "canvas",
      width: 1,
      layoutWidth,
      layoutHeight,
    }],
  };
}

async function installDeferredRuntimeProjectionHarness(page, {
  source = RUNTIME_HOST_SOURCE,
  id = "runtime-host",
  tagName = "div",
} = {}) {
  const sourceNodeId = runtimeSourceNodeId(source, id, tagName);
  await page.setContent(source);
  await page.addScriptTag({ content: await runtimeProjectionBundle() });
  await page.evaluate(({ sourceNodeAttribute, sourceNodeId: nodeId, id: targetId }) => {
    const host = document.getElementById(targetId);
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
  }, { sourceNodeAttribute: SOURCE_NODE_ATTRIBUTE, sourceNodeId, id });
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

test("direct runtime projection cancels a pending replacement when an undo reselects its mounted bitmap", async ({ page }) => {
  const { sourceNodeId } = await installDeferredRuntimeProjectionHarness(page, {
    source: RUNTIME_DIRECT_SOURCE,
    id: "runtime-direct",
    tagName: "canvas",
  });
  const first = runtimeDirectProjection(
    RUNTIME_DIRECT_SOURCE,
    sourceNodeId,
    "sha256:runtime-direct-first",
  );
  const second = runtimeDirectProjection(
    RUNTIME_DIRECT_SOURCE,
    sourceNodeId,
    "sha256:runtime-direct-second",
  );
  await page.evaluate(({ projection, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      projection,
    );
  }, { projection: first, source: RUNTIME_DIRECT_SOURCE });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.deferredCount()
  ))).toBe(1);
  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(page.locator("#runtime-direct")).toHaveAttribute(
    "data-pageroot-readonly-visual-sha",
    "sha256:runtime-direct-first",
  );

  await page.evaluate(({ projection, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      projection,
    );
  }, { projection: second, source: RUNTIME_DIRECT_SOURCE });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.deferredCount()
  ))).toBe(2);
  await page.evaluate(({ projection, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      projection,
    );
  }, { projection: first, source: RUNTIME_DIRECT_SOURCE });
  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(page.locator("#runtime-direct")).toHaveAttribute(
    "data-pageroot-readonly-visual-sha",
    "sha256:runtime-direct-first",
  );
});

test("direct runtime projection restores a current source style after a retained bitmap is rebased", async ({ page }) => {
  const { sourceNodeId } = await installDeferredRuntimeProjectionHarness(page, {
    source: RUNTIME_DIRECT_SOURCE,
    id: "runtime-direct",
    tagName: "canvas",
  });
  const initial = runtimeDirectProjection(
    RUNTIME_DIRECT_SOURCE,
    sourceNodeId,
    "sha256:runtime-direct-rebase",
  );
  await page.evaluate(({ projection, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      projection,
    );
  }, { projection: initial, source: RUNTIME_DIRECT_SOURCE });
  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
  });

  const updatedSource = RUNTIME_DIRECT_SOURCE.replace(
    "background-image:linear-gradient(red, blue);background-size:contain;width:30px;height:15px",
    "background-image:linear-gradient(green, black);background-size:cover;width:77px;height:33px",
  );
  const updatedSourceNodeId = runtimeSourceNodeId(
    updatedSource,
    "runtime-direct",
    "canvas",
  );
  const retained = runtimeDirectProjection(
    updatedSource,
    updatedSourceNodeId,
    "sha256:runtime-direct-rebase",
  );
  await page.evaluate(({ sourceNodeAttribute, nodeId }) => {
    const host = document.getElementById("runtime-direct");
    if (!host) throw new Error("Direct runtime host is missing.");
    host.setAttribute(
      "style",
      "background-image:linear-gradient(green, black);background-size:cover;width:77px;height:33px",
    );
    host.setAttribute(sourceNodeAttribute, nodeId);
  }, { sourceNodeAttribute: SOURCE_NODE_ATTRIBUTE, nodeId: updatedSourceNodeId });
  await page.evaluate(({ projection, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      projection,
    );
  }, { projection: retained, source: updatedSource });
  await expect(page.locator("#runtime-direct")).toHaveCSS("width", "640px");
  await expect(page.locator("#runtime-direct")).toHaveCSS("height", "320px");

  await page.evaluate(({ source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      null,
    );
  }, { source: updatedSource });
  await expect(page.locator("#runtime-direct")).toHaveCSS("width", "77px");
  await expect(page.locator("#runtime-direct")).toHaveCSS("height", "33px");
  await expect(page.locator("#runtime-direct")).toHaveCSS("background-size", "cover");
});

test("direct runtime projection never restores an old style over a source patch cleared before reapply", async ({ page }) => {
  const { sourceNodeId } = await installDeferredRuntimeProjectionHarness(page, {
    source: RUNTIME_DIRECT_SOURCE,
    id: "runtime-direct",
    tagName: "canvas",
  });
  const projection = runtimeDirectProjection(
    RUNTIME_DIRECT_SOURCE,
    sourceNodeId,
    "sha256:runtime-direct-clear-source-style",
  );
  await page.evaluate(({ projection: next, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      next,
    );
  }, { projection, source: RUNTIME_DIRECT_SOURCE });
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.deferredCount()
  ))).toBe(1);
  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
  });
  await page.evaluate(() => {
    const host = document.getElementById("runtime-direct");
    if (!host) throw new Error("Direct runtime host is missing.");
    host.setAttribute(
      "style",
      "background-image:linear-gradient(purple, white);background-size:cover;width:89px;height:55px",
    );
    window.PageRootRuntimeVisualTest.restoreRuntimeVisualProjection(document);
  });
  await expect(page.locator("#runtime-direct")).toHaveCSS("width", "89px");
  await expect(page.locator("#runtime-direct")).toHaveCSS("height", "55px");
  await expect(page.locator("#runtime-direct")).toHaveCSS("background-size", "cover");
});

test("direct runtime projection uses owner CSS-pixel geometry instead of PNG dimensions", async ({ page }) => {
  const { sourceNodeId } = await installDeferredRuntimeProjectionHarness(page, {
    source: RUNTIME_DIRECT_SOURCE,
    id: "runtime-direct",
    tagName: "canvas",
  });
  const projection = runtimeDirectProjection(
    RUNTIME_DIRECT_SOURCE,
    sourceNodeId,
    "sha256:runtime-direct-geometry",
    { layoutWidth: 800, layoutHeight: 400 },
  );
  await page.evaluate(({ projection, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      projection,
    );
  }, { projection, source: RUNTIME_DIRECT_SOURCE });
  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(page.locator("#runtime-direct")).toHaveCSS("width", "800px");
  await expect(page.locator("#runtime-direct")).toHaveCSS("height", "400px");
});

test("direct runtime projection removes retained axis-aligned transforms from owner geometry", async ({ page }) => {
  const { sourceNodeId } = await installDeferredRuntimeProjectionHarness(page, {
    source: RUNTIME_TRANSFORMED_DIRECT_SOURCE,
    id: "runtime-transformed-direct",
    tagName: "canvas",
  });
  const target = page.locator("#runtime-transformed-direct");
  const before = await target.boundingBox();
  if (!before) throw new Error("Transformed runtime host is not visible.");
  const projection = runtimeDirectProjection(
    RUNTIME_TRANSFORMED_DIRECT_SOURCE,
    sourceNodeId,
    "sha256:runtime-direct-transform",
    {
      layoutWidth: Math.ceil(before.width),
      layoutHeight: Math.ceil(before.height),
    },
  );
  await page.evaluate(({ next, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      next,
    );
  }, { next: projection, source: RUNTIME_TRANSFORMED_DIRECT_SOURCE });
  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
  });

  await expect(target).toHaveCSS("width", "100px");
  await expect(target).toHaveCSS("height", "50px");
  const after = await target.boundingBox();
  if (!after) throw new Error("Transformed runtime host disappeared.");
  expect(after.width).toBeCloseTo(before.width, 3);
  expect(after.height).toBeCloseTo(before.height, 3);
});

test("direct runtime projection removes retained zoom from owner geometry", async ({ page }) => {
  const { sourceNodeId } = await installDeferredRuntimeProjectionHarness(page, {
    source: RUNTIME_ZOOMED_DIRECT_SOURCE,
    id: "runtime-zoomed-direct",
    tagName: "canvas",
  });
  const target = page.locator("#runtime-zoomed-direct");
  const before = await target.boundingBox();
  if (!before) throw new Error("Zoomed runtime host is not visible.");
  const projection = runtimeDirectProjection(
    RUNTIME_ZOOMED_DIRECT_SOURCE,
    sourceNodeId,
    "sha256:runtime-direct-zoom",
    {
      layoutWidth: Math.ceil(before.width),
      layoutHeight: Math.ceil(before.height),
    },
  );
  await page.evaluate(({ next, source }) => {
    window.PageRootRuntimeVisualTest.applyRuntimeVisualProjectionToDocument(
      document,
      source,
      next,
    );
  }, { next: projection, source: RUNTIME_ZOOMED_DIRECT_SOURCE });
  await page.evaluate(async () => {
    window.__PAGEROOT_RUNTIME_VISUAL_TEST__.resolve(0);
    await Promise.resolve();
    await Promise.resolve();
  });

  await expect(target).toHaveCSS("width", "120px");
  await expect(target).toHaveCSS("height", "60px");
  const after = await target.boundingBox();
  if (!after) throw new Error("Zoomed runtime host disappeared.");
  expect(after.width).toBeCloseTo(before.width, 3);
  expect(after.height).toBeCloseTo(before.height, 3);
});
