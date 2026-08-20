import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadVersionGraph() {
  const typescript = await import("typescript");
  const source = await readFile(
    new URL("../app/workbench/version-graph.ts", import.meta.url),
    "utf8",
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: "version-graph.ts",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`,
  );
}

const { versionGraphLayout, versionEntryTitle } = await loadVersionGraph();

function version(ordinal, basedOnOrdinal) {
  return {
    id: `v${ordinal}`,
    ordinal,
    basedOnVersionId: basedOnOrdinal === null ? null : `v${basedOnOrdinal}`,
    previousVersionId: ordinal > 1 ? `v${ordinal - 1}` : null,
  };
}

function laneByVersion(layout) {
  return Object.fromEntries(
    layout.rows.map((row) => [row.versionId, row.lane]),
  );
}

function title(input) {
  return versionEntryTitle({
    isInitial: false,
    comments: [],
    directEditCount: 0,
    ...input,
  });
}

test("a purely sequential history stays on one lane with no fork edges", () => {
  const layout = versionGraphLayout([
    version(1, null),
    version(2, 1),
    version(3, 2),
  ]);
  assert.equal(layout.laneCount, 1);
  assert.deepEqual(layout.edges, []);
  assert.deepEqual(layout.rows.map((row) => row.ordinal), [1, 2, 3]);
  assert.deepEqual(layout.rows.map((row) => row.lane), [0, 0, 0]);
  // Every step after the import is drawn as one straight run down lane 0.
  assert.deepEqual(layout.segments, [
    { lane: 0, fromRow: 0, toRow: 1 },
    { lane: 0, fromRow: 1, toRow: 2 },
  ]);
});

test("versions are ordered oldest first regardless of input order", () => {
  const layout = versionGraphLayout([
    version(3, 2),
    version(1, null),
    version(2, 1),
  ]);
  assert.deepEqual(layout.rows.map((row) => row.ordinal), [1, 2, 3]);
  assert.deepEqual(layout.rows.map((row) => row.row), [0, 1, 2]);
});

test("branching off a version that is no longer a lane tip opens a new lane", () => {
  // V1..V3 sequential, then V4 goes back to V2: V3 already holds lane 0's tip.
  const layout = versionGraphLayout([
    version(1, null),
    version(2, 1),
    version(3, 2),
    version(4, 2),
    version(5, 4),
  ]);
  assert.equal(layout.laneCount, 2);
  assert.deepEqual(laneByVersion(layout), { v1: 0, v2: 0, v3: 0, v4: 1, v5: 1 });
  assert.deepEqual(layout.edges, [{
    fromVersionId: "v2",
    toVersionId: "v4",
    fromLane: 0,
    toLane: 1,
    fromRow: 1,
    toRow: 3,
  }]);
  // The fork itself is an edge, never a lane segment; only V5 continues lane 1.
  assert.deepEqual(layout.segments, [
    { lane: 0, fromRow: 0, toRow: 1 },
    { lane: 0, fromRow: 1, toRow: 2 },
    { lane: 1, fromRow: 3, toRow: 4 },
  ]);
});

test("the documented 20-version history resolves to four lanes and three forks", () => {
  // Main line V1-V6; V7 branches from V3; V11 branches from V4; V19 from V16.
  const layout = versionGraphLayout([
    version(1, null),
    version(2, 1),
    version(3, 2),
    version(4, 3),
    version(5, 4),
    version(6, 5),
    version(7, 3),
    version(8, 7),
    version(9, 8),
    version(10, 9),
    version(11, 4),
    version(12, 11),
    version(13, 12),
    version(14, 13),
    version(15, 14),
    version(16, 15),
    version(17, 16),
    version(18, 17),
    version(19, 16),
    version(20, 19),
  ]);
  assert.equal(layout.laneCount, 4);
  const lanes = laneByVersion(layout);
  assert.deepEqual(
    [lanes.v1, lanes.v2, lanes.v3, lanes.v4, lanes.v5, lanes.v6],
    [0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual([lanes.v7, lanes.v8, lanes.v9, lanes.v10], [1, 1, 1, 1]);
  assert.deepEqual([lanes.v11, lanes.v16, lanes.v18], [2, 2, 2]);
  assert.deepEqual([lanes.v19, lanes.v20], [3, 3]);
  assert.deepEqual(
    layout.edges.map((edge) => [edge.fromVersionId, edge.toVersionId]),
    [["v3", "v7"], ["v4", "v11"], ["v16", "v19"]],
  );
  // A fork always moves outward, so drawn connectors never cross back.
  for (const edge of layout.edges) {
    assert.ok(edge.toLane > edge.fromLane);
    assert.ok(edge.toRow > edge.fromRow);
  }
  // Segments only ever join adjacent rows on one lane, so no line jumps a fork.
  for (const segment of layout.segments) {
    assert.equal(segment.toRow - segment.fromRow, 1);
  }
  assert.equal(layout.segments.length + layout.edges.length, 19);
});

test("previousVersionId is the lineage fallback when basedOnVersionId is absent", () => {
  const layout = versionGraphLayout([
    { id: "v1", ordinal: 1, basedOnVersionId: null, previousVersionId: null },
    { id: "v2", ordinal: 2, basedOnVersionId: null, previousVersionId: "v1" },
  ]);
  assert.equal(layout.laneCount, 1);
  assert.deepEqual(layout.edges, []);
});

test("an unknown lineage parent starts a lane without inventing an edge", () => {
  const layout = versionGraphLayout([
    { id: "v9", ordinal: 9, basedOnVersionId: "missing", previousVersionId: null },
  ]);
  assert.deepEqual(laneByVersion(layout), { v9: 0 });
  assert.deepEqual(layout.edges, []);
});

test("an empty history produces an empty layout", () => {
  const layout = versionGraphLayout([]);
  assert.deepEqual(layout.rows, []);
  assert.deepEqual(layout.segments, []);
  assert.deepEqual(layout.edges, []);
  assert.equal(layout.laneCount, 0);
});

test("the initial version is titled by its import, not by a summary field", () => {
  assert.equal(
    versionEntryTitle({ isInitial: true, comments: [], directEditCount: 0 }),
    "原始导入",
  );
});

test("a version is titled by the user's own first requirement", () => {
  assert.equal(
    title({ comments: [{ label: "主按钮", text: "颜色统一成品牌紫" }] }),
    "主按钮：颜色统一成品牌紫",
  );
});

test("multiple requirements keep the first one and count the rest", () => {
  assert.equal(
    title({
      comments: [
        { label: "价格表", text: "改成两档" },
        { label: "页脚", text: "标题再短一点" },
      ],
    }),
    "价格表：改成两档 等 2 条",
  );
});

test("a requirement spanning lines is condensed to a single line", () => {
  assert.equal(
    title({ comments: [{ label: "首屏", text: "改成\n  左文右图  " }] }),
    "首屏：改成 左文右图",
  );
});

test("an over-long requirement is truncated instead of overflowing the row", () => {
  const long = "改".repeat(120);
  const result = title({ comments: [{ label: "页面", text: long }] });
  assert.ok(result.startsWith("页面：改"));
  assert.ok(result.endsWith("…"));
  assert.ok(result.length < long.length);
});

test("an attachment-only comment falls back to its target label", () => {
  assert.equal(title({ comments: [{ label: "主视觉图", text: "   " }] }), "主视觉图");
});

test("a version with no comments is titled by its local edits", () => {
  assert.equal(title({ directEditCount: 3 }), "本地编辑 · 3 处");
});

test("a version whose requirement is unavailable stays untitled instead of filler", () => {
  // The v4 workspace payload carries no per-version comments, so a filler label
  // would repeat on every row; the row still shows its V-number and time.
  assert.equal(title({}), "");
});

test("a branch head names the version it forked from when nothing else is known", () => {
  assert.equal(title({ branchedFromOrdinal: 16 }), "从 V16 分出");
});

test("the round's frozen requirement titles a version that carries no comments", () => {
  // Current projects keep comments in the request, not on the version, so this
  // is the path that actually names versions in the product.
  assert.equal(
    title({ requirement: "价格表：改成两档" }),
    "价格表：改成两档",
  );
});

test("a frozen requirement outranks both local edits and the branch fallback", () => {
  assert.equal(
    title({
      requirement: "页脚：加上备案号",
      directEditCount: 2,
      branchedFromOrdinal: 4,
    }),
    "页脚：加上备案号",
  );
});

test("a blank frozen requirement falls through instead of titling nothing", () => {
  assert.equal(title({ requirement: "   ", branchedFromOrdinal: 4 }), "从 V4 分出");
});

test("the user's requirement still outranks the branch fallback", () => {
  assert.equal(
    title({
      comments: [{ label: "价格表", text: "改成两档" }],
      requirement: "应当被评论超过",
      branchedFromOrdinal: 16,
    }),
    "价格表：改成两档",
  );
});
