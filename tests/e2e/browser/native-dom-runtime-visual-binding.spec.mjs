import { expect, test } from "@playwright/test";

import { generatedReviewBootstrap } from "../../helpers/generated-review-bootstrap.mjs";

const COMMENT_SOURCE_BOX_SIGNATURE = JSON.stringify([
  ["class", "comment-host"],
  ["height", null],
  ["hidden", null],
  ["style", null],
  ["width", null],
]);

async function parsedReviewCommentLayouts(page, { binding, authoredScript }) {
  const bootstrap = generatedReviewBootstrap([], [binding]);
  await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; }
      main { display: block; }
      .comment-host { display: block; width: 10px; height: 10px; }
    </style>
    <script>${bootstrap}</script>
  </head>
  <body>
    <main></main>
    <script>${authoredScript}</script>
  </body>
</html>`, { waitUntil: "load" });
  return page.evaluate(async ({ sessionId, side }) => {
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
      commentPort.postMessage({
        source: "pageroot-ai-review-comment-targets",
        sessionId,
        side,
        type: "comment-targets",
        reviewCommentTargets: [{
          key: "parsed-comment",
          selector: ".comment-host",
          sourceNodeId: "element:1:1:div",
        }],
      });
      while (
        !messages.some((message) => (
          message.commentLayouts?.some((layout) => layout.key === "parsed-comment")
        ))
        && Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return { channel: true, layouts: messages };
    } finally {
      removeEventListener("message", receive);
    }
  }, { sessionId: "review-session", side: "before" });
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
