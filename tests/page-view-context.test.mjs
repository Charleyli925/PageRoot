import assert from "node:assert/strict";
import test from "node:test";

import {
  PAGE_VIEW_CONTEXT_PROTOCOL,
  PAGE_VIEW_CONTEXT_VERSION,
  createPageViewContext,
  resolvePageViewContext,
} from "../app/lib/page-view-context.js";
import { buildSourceIndex } from "../app/lib/source-index.js";

const TAB_HTML = `<!doctype html>
<html>
<head>
  <style>
    .panel { display: none; }
    .panel.active { display: block; }
  </style>
</head>
<body>
  <nav>
    <button id="tab-one" class="tab active" aria-selected="true">第一页</button>
    <button id="tab-two" class="tab" aria-selected="false">第二页</button>
  </nav>
  <section id="panel-one" class="panel active"><p>第一页正文</p></section>
  <section id="panel-two" class="panel"><p>第二页正文</p></section>
  <details id="notes"><summary>说明</summary><p>静态详情</p></details>
</body>
</html>`;

function sourceNodeId(index, id) {
  const element = index.elements.find(
    (candidate) => candidate.stableAttributes.id === id,
  );
  assert.ok(element, `missing synthetic source element #${id}`);
  return element.nodeId;
}

function switchedSnapshot(html = TAB_HTML) {
  const index = buildSourceIndex(html);
  return {
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    sourceSha256: index.sourceSha256,
    truncated: false,
    entries: [
      {
        sourceNodeId: sourceNodeId(index, "tab-one"),
        className: "tab",
        hidden: false,
        open: false,
        ariaSelected: "false",
        ariaExpanded: null,
        display: "inline-block",
        visibility: "visible",
      },
      {
        sourceNodeId: sourceNodeId(index, "tab-two"),
        className: "tab active",
        hidden: false,
        open: false,
        ariaSelected: "true",
        ariaExpanded: null,
        display: "inline-block",
        visibility: "visible",
      },
      {
        sourceNodeId: sourceNodeId(index, "panel-one"),
        className: "panel",
        hidden: false,
        open: false,
        ariaSelected: null,
        ariaExpanded: null,
        display: "none",
        visibility: "visible",
      },
      {
        sourceNodeId: sourceNodeId(index, "panel-two"),
        className: "panel active",
        hidden: false,
        open: false,
        ariaSelected: null,
        ariaExpanded: null,
        display: "block",
        visibility: "visible",
      },
      {
        sourceNodeId: sourceNodeId(index, "notes"),
        className: "",
        hidden: false,
        open: true,
        ariaSelected: null,
        ariaExpanded: null,
        display: "block",
        visibility: "visible",
      },
      {
        sourceNodeId: "runtime-only-table-row",
        className: "active",
        hidden: false,
        open: false,
        ariaSelected: null,
        ariaExpanded: null,
        display: "table-row",
        visibility: "visible",
      },
    ],
  };
}

test("page view context carries only source-backed Tab and semantic display state", () => {
  const context = createPageViewContext({
    html: TAB_HTML,
    documentKey: "/tmp/report.html",
    generation: 7,
    snapshot: switchedSnapshot(),
  });

  assert.ok(context);
  assert.equal(context.documentKey, "/tmp/report.html");
  assert.equal(context.generation, 7);
  assert.equal(context.entries.length, 5);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.entries), true);

  const classAdds = context.entries.flatMap((entry) => entry.classAdd);
  const classRemoves = context.entries.flatMap((entry) => entry.classRemove);
  assert.deepEqual([...new Set(classAdds)], ["active"]);
  assert.deepEqual([...new Set(classRemoves)], ["active"]);
  assert.equal(
    context.entries.some((entry) => entry.open === true),
    true,
  );
  assert.equal(
    context.entries.some(
      (entry) => entry.targetRef.targetId === "runtime-only-table-row",
    ),
    false,
  );
  for (const entry of context.entries) {
    assert.equal(Object.hasOwn(entry, "textContent"), false);
    assert.equal(Object.hasOwn(entry, "innerHTML"), false);
    assert.equal(Object.hasOwn(entry, "style"), false);
  }
});

test("page view context rebinds to edited source without copying runtime DOM", () => {
  const context = createPageViewContext({
    html: TAB_HTML,
    documentKey: "/tmp/report.html",
    generation: 2,
    snapshot: switchedSnapshot(),
  });
  assert.ok(context);

  const editedHtml = TAB_HTML.replace(
    "第二页正文",
    "第二页正文，已经在源页中编辑",
  );
  const resolved = resolvePageViewContext(editedHtml, context);
  const resolvedIds = new Set(
    resolved.entries.map(({ sourceNodeId }) => (
      resolved.sourceIndex.byNodeId.get(sourceNodeId)?.stableAttributes.id
    )),
  );
  assert.deepEqual(
    [...resolvedIds].sort(),
    ["notes", "panel-one", "panel-two", "tab-one", "tab-two"],
  );
  assert.equal(
    resolved.entries.every(({ resolution }) => (
      resolution === "exact" || resolution === "rebound"
    )),
    true,
  );
});

test("page view context carries bounded read-only visuals only for empty source placeholders", () => {
  const html = `<!doctype html>
<main>
  <div id="chart" style="height: 120px"></div>
  <table><tbody id="rows"></tbody></table>
  <div id="authored">静态内容</div>
</main>`;
  const index = buildSourceIndex(html);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==";
  const context = createPageViewContext({
    html,
    documentKey: "memory:visuals",
    generation: 3,
    snapshot: {
      protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
      version: PAGE_VIEW_CONTEXT_VERSION,
      sourceSha256: index.sourceSha256,
      truncated: false,
      entries: [],
      visuals: [
        {
          sourceNodeId: sourceNodeId(index, "chart"),
          kind: "canvas-bitmap",
          width: 320,
          height: 120,
          dataUrl: png,
        },
        {
          sourceNodeId: sourceNodeId(index, "rows"),
          kind: "table-body",
          html: [
            '<tr onclick="bad()"><td style="color:#dc2626;font-weight:700;background:#faf5fc;position:fixed">',
            "动态行",
            '<script>alert(1)</script><img src="bad.png"></td></tr>',
          ].join(""),
        },
        {
          sourceNodeId: sourceNodeId(index, "authored"),
          kind: "canvas-bitmap",
          width: 1,
          height: 1,
          dataUrl: png,
        },
        {
          sourceNodeId: "runtime-only",
          kind: "table-body",
          html: "<tr><td>运行时节点</td></tr>",
        },
      ],
    },
  });

  assert.ok(context);
  assert.equal(context.entries.length, 0);
  assert.equal(context.visuals.length, 2);
  assert.deepEqual(
    context.visuals.map((visual) => visual.kind),
    ["canvas-bitmap", "table-body"],
  );
  const tableVisual = context.visuals.find((visual) => visual.kind === "table-body");
  assert.equal(
    tableVisual.html,
    '<tr><td style="color:#dc2626;font-weight:700;background:#faf5fc">动态行</td></tr>',
  );
  assert.equal(Object.isFrozen(context.visuals), true);
  assert.equal(Object.isFrozen(context.visuals[0]), true);

  const resolved = resolvePageViewContext(
    html.replace("静态内容", "仍是静态内容"),
    context,
  );
  assert.equal(resolved.entries.length, 0);
  assert.equal(resolved.visuals.length, 2);
});

test("arbitrary runtime classes, stale source, and truncated snapshots fail closed", () => {
  const html = `<!doctype html><main><section id="card" class="card">正文</section></main>`;
  const index = buildSourceIndex(html);
  const snapshot = {
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    sourceSha256: index.sourceSha256,
    truncated: false,
    entries: [{
      sourceNodeId: sourceNodeId(index, "card"),
      className: "card loading",
      hidden: false,
      open: false,
      ariaSelected: null,
      ariaExpanded: null,
      display: "block",
      visibility: "visible",
    }],
  };

  assert.equal(createPageViewContext({
    html,
    documentKey: "memory:1",
    generation: 1,
    snapshot,
  }), null);
  assert.equal(createPageViewContext({
    html,
    documentKey: "memory:1",
    generation: 1,
    snapshot: {
      ...snapshot,
      sourceSha256: "sha256:stale",
    },
  }), null);
  assert.equal(createPageViewContext({
    html,
    documentKey: "memory:1",
    generation: 1,
    snapshot: {
      ...snapshot,
      truncated: true,
    },
  }), null);
});
