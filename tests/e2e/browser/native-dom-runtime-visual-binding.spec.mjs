import { expect, test } from "@playwright/test";

import { generatedReviewBootstrap } from "../../helpers/generated-review-bootstrap.mjs";

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

const RUNTIME_SOURCE_BOX_SIGNATURE = JSON.stringify([
  ["class", "runtime-host"],
  ["height", null],
  ["hidden", null],
  ["style", null],
  ["width", null],
]);

async function parsedRuntimeVisualSnapshots(page, {
  binding,
  bindings = binding ? [binding] : [],
  authoredScript,
}) {
  const runtimeBindings = bindings;
  const bootstrap = generatedReviewBootstrap(
    runtimeBindings.map(({ key }) => key),
    [],
    runtimeBindings,
  );
  await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; }
      main { display: block; }
      .runtime-host { display: block; width: 10px; height: 10px; }
    </style>
    <script>${bootstrap}</script>
  </head>
  <body>
    <main></main>
    <script>${authoredScript}</script>
  </body>
</html>`, { waitUntil: "load" });
  return page.evaluate(async ({ sessionId, sourceSha256 }) => {
    const snapshots = [];
    let runtimePort = null;
    const receive = (event) => {
      const message = event.data;
      if (
        message?.source === "pageroot-ai-review"
        && message.type === "runtime-visual-channel"
      ) {
        runtimePort = event.ports?.[0] || null;
        runtimePort?.start?.();
        runtimePort?.addEventListener("message", (portEvent) => {
          const payload = portEvent.data;
          if (
            payload?.source === "pageroot-ai-review-runtime-visual"
            && payload.type === "runtime-visual-snapshots"
          ) snapshots.push(payload.runtimeVisualSnapshots);
        });
      }
    };
    addEventListener("message", receive);
    try {
      const challenge = "a".repeat(32);
      postMessage({
        source: "pageroot-ai-review-parent",
        sessionId,
        type: "request-runtime-visual-channel",
        contractVersion: 1,
        sourceSha256,
        challenge,
      }, "*");
      const deadline = Date.now() + 4_000;
      while (!runtimePort && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      while (!snapshots.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return { channel: Boolean(runtimePort), snapshots };
    } finally {
      removeEventListener("message", receive);
    }
  }, {
    sessionId: "review-session",
    sourceSha256: `sha256:${"a".repeat(64)}`,
  });
}

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
  const bootstrap = generatedReviewBootstrap([], commentBindings);
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

test("fingerprintless runtime hosts fail closed when a same-tag parser decoy shifts the target", async ({ page }) => {
  const binding = {
    key: "runtime-host-1",
    path: [1, 0, 0],
    tagName: "DIV",
    sourceBoxSignature: RUNTIME_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
  };
  const stable = await parsedRuntimeVisualSnapshots(page, {
    binding,
    authoredScript: `
      const main = document.querySelector("main");
      const actual = document.createElement("div");
      actual.className = "runtime-host";
      const painted = document.createElement("i");
      painted.style.cssText = "display:block;background:red;width:8px;height:8px";
      actual.append(painted);
      main.append(actual);
      main.append(document.createElement("div"));
    `,
  });
  expect(stable.channel).toBe(true);
  expect(stable.snapshots).toHaveLength(1);
  expect(stable.snapshots[0]).toHaveLength(1);

  const decoy = await parsedRuntimeVisualSnapshots(page, {
    binding,
    authoredScript: `
      const main = document.querySelector("main");
      const decoy = document.createElement("div");
      decoy.className = "runtime-host";
      main.append(decoy);
      const actual = document.createElement("div");
      actual.className = "runtime-host";
      const painted = document.createElement("i");
      painted.style.cssText = "display:block;background:red;width:8px;height:8px";
      actual.append(painted);
      main.append(actual);
    `,
  });
  expect(decoy.channel).toBe(true);
  expect(decoy.snapshots).toHaveLength(0);
});

test("identical fingerprintless runtime siblings keep their separate frozen paths", async ({ page }) => {
  const bindings = [0, 1].map((index) => ({
    key: `runtime-host-${index + 1}`,
    path: [1, 0, index],
    tagName: "DIV",
    sourceBoxSignature: RUNTIME_SOURCE_BOX_SIGNATURE,
    identityAttributes: [],
  }));
  const result = await parsedRuntimeVisualSnapshots(page, {
    bindings,
    authoredScript: `
      const main = document.querySelector("main");
      for (let index = 0; index < 2; index += 1) {
        const actual = document.createElement("div");
        actual.className = "runtime-host";
        const painted = document.createElement("i");
        painted.style.cssText = "display:block;background:red;width:8px;height:8px";
        actual.append(painted);
        main.append(actual);
      }
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.snapshots).toHaveLength(1);
  expect(result.snapshots[0]).toHaveLength(2);
});
