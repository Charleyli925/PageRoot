import { expect, test } from "@playwright/test";

import { generatedReviewBootstrap } from "../../helpers/generated-review-bootstrap.mjs";

const COMMENT_STABLE_ID = "pr1_11111111111141118111111111111111";
const COMMENT_STABLE_ID_B = "pr1_22222222222242228222222222222222";

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

test("path-only review comments bind against a real parsed DOM", {
  tag: ["@gate-smoke","@smoke-review"],
}, async ({ page }) => {
  const binding = {
    sourceNodeId: COMMENT_STABLE_ID,
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

test("private visual capability observes the actual stable host after authored runtime mutation", async ({ page }) => {
  const bootstrap = generatedReviewBootstrap(
    [],
    "after",
    ["pr1_11111111111141118111111111111111"],
  );
  await page.setContent(`<!doctype html><script>${bootstrap}</script><main data-pageroot-id="pr1_11111111111141118111111111111111">old</main><script>document.querySelector('main').textContent = 'runtime new'</script>`);
  const result = await page.evaluate(async () => {
    let port;
    const listener = (event) => {
      if (event.data?.type === "review-visual-channel") port = event.ports[0];
    };
    addEventListener("message", listener);
    postMessage({ source: "pageroot-ai-review-parent", sessionId: "review-session", type: "request-review-visual-channel", challenge: "b".repeat(32) }, "*");
    const until = Date.now() + 3000;
    while (!port && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!port) return null;
    const observations = await new Promise((resolve) => {
      port.onmessage = (event) => resolve(event.data.observations);
      port.postMessage({ type: "observe", sessionId: "review-session", side: "after", sourceHash: "sha256:test", generation: 0, candidates: [{ stableId: "pr1_11111111111141118111111111111111", present: true }] });
    });
    removeEventListener("message", listener);
    return observations;
  });
  expect(result).toHaveLength(1);
  expect(result[0].visible).toBe(true);
  expect(result[0].fingerprint).toMatch(/^\d+:\d+$/u);
});

test("source-backed comment IDs survive an authored RegExp exec mutation", {
  tag: ["@gate-smoke","@smoke-comments"],
}, async ({ page }) => {
  const binding = {
    sourceNodeId: COMMENT_STABLE_ID,
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

test("review comment keys survive an authored String replace mutation", {
  tag: ["@gate-smoke","@smoke-review"],
}, async ({ page }) => {
  const binding = {
    sourceNodeId: COMMENT_STABLE_ID,
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

test("path-only review comments fail closed when the parsed path and tag diverge", {
  tag: ["@gate-smoke","@smoke-review"],
}, async ({ page }) => {
  const binding = {
    sourceNodeId: COMMENT_STABLE_ID,
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

test("path-only review comments fail closed when a same-tag parser decoy shifts the target", {
  tag: ["@gate-smoke","@smoke-review"],
}, async ({ page }) => {
  const binding = {
    sourceNodeId: COMMENT_STABLE_ID,
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

test("a pre-author Stable ID binding survives a same-tag parser decoy", {
  tag: ["@gate-smoke","@smoke-review"],
}, async ({ page }) => {
  const stableId = "pr1_11111111111141118111111111111111";
  const binding = {
    sourceNodeId: COMMENT_STABLE_ID,
    path: [1, 0, 0],
    tagName: "DIV",
    sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
    identityAttributes: [["data-pageroot-id", stableId]],
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
      actualTarget.setAttribute("data-pageroot-id", ${JSON.stringify(stableId)});
      main.append(actualTarget);
    `,
  });
  expect(result.channel).toBe(true);
  expect(result.layouts.some((message) => (
    message.commentLayouts?.some((layout) => layout.key === "parsed-comment")
  ))).toBe(true);
});

test("path-only review comments keep a bound target when a later same-tag node is unrelated", {
  tag: ["@gate-smoke","@smoke-review"],
}, async ({ page }) => {
  const binding = {
    sourceNodeId: COMMENT_STABLE_ID,
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

test("identical path-only comment siblings keep their separate frozen paths", {
  tag: ["@gate-smoke","@smoke-review"],
}, async ({ page }) => {
  const bindings = [0, 1].map((index) => ({
    sourceNodeId: index === 0 ? COMMENT_STABLE_ID : COMMENT_STABLE_ID_B,
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

test("mixed-shape path-only comment decoys fail closed", {
  tag: ["@gate-smoke","@smoke-review"],
}, async ({ page }) => {
  const bindings = [
    {
      sourceNodeId: COMMENT_STABLE_ID,
      path: [1, 0, 0],
      tagName: "DIV",
      sourceBoxSignature: COMMENT_SOURCE_BOX_SIGNATURE,
      identityAttributes: [],
      identityText: "",
    },
    {
      sourceNodeId: COMMENT_STABLE_ID_B,
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
