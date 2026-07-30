import assert from "node:assert/strict";
import test from "node:test";

import {
  PAGE_VIEW_CONTEXT_PROTOCOL,
  PAGE_VIEW_CONTEXT_VERSION,
  createPagePresentationAction,
  createPageViewContext,
  resolvePageViewContext,
} from "../app/lib/page-view-context.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import { createTargetRef } from "../app/lib/target-resolver.js";

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

const PRESENTATION_HTML = `<!doctype html>
<html>
<body>
  <nav role="tablist" aria-label="报告页签">
    <button id="tab-one" role="tab" aria-controls="panel-one" aria-selected="true"><span>第一页</span></button>
    <button id="tab-two" role="tab" aria-controls="panel-two" aria-selected="false"><span id="tab-two-label">第二页</span></button>
  </nav>
  <section id="panel-one" role="tabpanel"><p>第一页正文</p></section>
  <section id="panel-two" role="tabpanel" hidden><p>第二页正文</p></section>
  <details id="notes"><summary id="notes-summary">查看说明</summary><p>静态详情</p></details>
  <section>
    <h2><button id="more-toggle" aria-expanded="false" aria-controls="more-content">更多内容</button></h2>
    <div id="more-content" role="region" aria-labelledby="more-toggle" hidden><p>补充正文</p></div>
  </section>
  <a id="outside-link" href="https://example.com/">外部链接</a>
</body>
</html>`;

function sourceNodeId(index, id) {
  const element = index.elements.find(
    (candidate) => candidate.stableAttributes.id === id,
  );
  assert.ok(element, `missing synthetic source element #${id}`);
  return element.nodeId;
}

function targetRef(index, id) {
  const element = index.elements.find(
    (candidate) => candidate.stableAttributes.id === id,
  );
  assert.ok(element, `missing synthetic source element #${id}`);
  return createTargetRef(index, element, { level: "subregion" });
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

test("semantic Tab actions switch only disposable presentation context", () => {
  const html = PRESENTATION_HTML;
  const index = buildSourceIndex(html);
  const action = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:/tmp/report.html",
    generation: 5,
    targetRef: targetRef(index, "tab-two-label"),
  });

  assert.ok(action);
  assert.equal(action.kind, "activate-tab");
  assert.equal(action.label, "切换到此页签");
  assert.equal(action.isCurrent, false);
  assert.ok(action.nextContext);
  assert.equal(action.nextContext.documentKey, "editing:/tmp/report.html");
  assert.equal(action.nextContext.generation, 5);
  assert.deepEqual(action.nextContext.visuals, []);
  assert.equal(index.source, html);

  const resolved = resolvePageViewContext(html, action.nextContext);
  const stateById = new Map(resolved.entries.map((item) => [
    resolved.sourceIndex.byNodeId.get(item.sourceNodeId)?.stableAttributes.id,
    item.entry,
  ]));
  assert.equal(stateById.get("tab-one")?.ariaSelected, "false");
  assert.equal(stateById.get("tab-two")?.ariaSelected, "true");
  assert.equal(stateById.get("panel-one")?.hidden, true);
  assert.equal(stateById.get("panel-two")?.hidden, false);
  assert.equal(stateById.size, 4);

  const currentAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:/tmp/report.html",
    generation: 99,
    currentContext: action.nextContext,
    targetRef: targetRef(index, "tab-two"),
  });
  assert.ok(currentAction);
  assert.equal(currentAction.label, "当前页签");
  assert.equal(currentAction.isCurrent, true);
  assert.deepEqual(currentAction.nextContext, action.nextContext);
});

test("presentation actions preserve bounded read-only visuals", () => {
  const html = PRESENTATION_HTML.replace(
    "</body>",
    '<div id="chart" style="height: 120px"></div></body>',
  );
  const index = buildSourceIndex(html);
  const context = createPageViewContext({
    html,
    documentKey: "editing:visuals",
    generation: 7,
    snapshot: {
      protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
      version: PAGE_VIEW_CONTEXT_VERSION,
      sourceSha256: index.sourceSha256,
      truncated: false,
      entries: [],
      visuals: [{
        sourceNodeId: sourceNodeId(index, "chart"),
        kind: "canvas-bitmap",
        width: 320,
        height: 120,
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==",
      }],
    },
  });
  assert.ok(context);

  const action = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:visuals",
    currentContext: context,
    targetRef: targetRef(index, "tab-two"),
  });
  assert.ok(action?.nextContext);
  assert.deepEqual(action.nextContext.visuals, context.visuals);
  assert.equal(Object.isFrozen(action.nextContext.visuals), true);
  assert.equal(Object.isFrozen(action.nextContext.visuals[0]), true);
});

test("details and strict local disclosure actions preserve existing context", () => {
  const html = PRESENTATION_HTML;
  const index = buildSourceIndex(html);
  const tabAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    generation: 3,
    targetRef: targetRef(index, "tab-two"),
  });
  assert.ok(tabAction?.nextContext);

  const detailsAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    currentContext: tabAction.nextContext,
    targetRef: targetRef(index, "notes-summary"),
  });
  assert.ok(detailsAction);
  assert.equal(detailsAction.kind, "toggle-details");
  assert.equal(detailsAction.label, "展开内容");
  assert.equal(detailsAction.nextContext?.entries.length, 5);

  const disclosureAction = createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    currentContext: detailsAction.nextContext,
    targetRef: targetRef(index, "more-toggle"),
  });
  assert.ok(disclosureAction);
  assert.equal(disclosureAction.kind, "toggle-disclosure");
  assert.equal(disclosureAction.label, "展开内容");
  assert.equal(disclosureAction.nextContext?.entries.length, 7);

  const resolved = resolvePageViewContext(html, disclosureAction.nextContext);
  const stateById = new Map(resolved.entries.map((item) => [
    resolved.sourceIndex.byNodeId.get(item.sourceNodeId)?.stableAttributes.id,
    item.entry,
  ]));
  assert.equal(stateById.get("notes")?.open, true);
  assert.equal(stateById.get("more-toggle")?.ariaExpanded, "true");
  assert.equal(stateById.get("more-content")?.hidden, false);
  assert.equal(stateById.get("panel-two")?.hidden, false);
});

test("links, popups, grouped details, and ambiguous Tab markup remain inert", () => {
  const html = `${PRESENTATION_HTML}
<details id="grouped-details" name="exclusive"><summary id="grouped-summary">分组详情</summary><p>内容</p></details>
<section><button id="popup-toggle" aria-expanded="false" aria-controls="popup-content" aria-haspopup="dialog">弹窗</button><div id="popup-content" role="region" aria-labelledby="popup-toggle" hidden>内容</div></section>
<div role="tablist"><button id="bad-tab-one" role="tab" aria-selected="true">一</button><button role="tab" aria-selected="false">二</button></div>`;
  const index = buildSourceIndex(html);
  const resolve = (id) => createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    targetRef: targetRef(index, id),
  });

  assert.equal(resolve("outside-link"), null);
  assert.equal(resolve("grouped-summary"), null);
  assert.equal(resolve("popup-toggle"), null);
  assert.equal(resolve("bad-tab-one"), null);
  assert.equal(createPagePresentationAction({
    html,
    sourceIndex: index,
    documentKey: "editing:memory",
    currentContext: {
      protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
      version: PAGE_VIEW_CONTEXT_VERSION,
      documentKey: "editing:memory",
      generation: 0,
      sourceSha256: index.sourceSha256,
      entries: [{
        targetRef: targetRef(index, "tab-one"),
        classAdd: "not-an-array",
        classRemove: [],
      }],
    },
    targetRef: targetRef(index, "tab-two"),
  }), null);
});
