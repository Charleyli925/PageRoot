/**
 * Synthetic before/after page pairs for the Review runtime visual census.
 *
 * Every page is generated here, never copied from a real user document. Each
 * pair declares what its chart hosts are expected to do, so one census run
 * measures both directions at once:
 *
 * - `chartExpectation: "unchanged"` — the chart draws identical pixels on both
 *   sides. A confirmed visual change here is a false positive.
 * - `chartExpectation: "changed"` — the chart genuinely draws different pixels.
 *   Missing it is a false negative. These positive controls exist so a census
 *   cannot be satisfied by a pipeline that simply reports nothing.
 *
 * The chart script is parameterized instead of loading a real library:
 * `animationMs` and `libraryDelayMs` let the census sweep the boundary that a
 * fixed capture settle wait is betting on, and the settled frame is an exact
 * function of the data so a properly sampled pair is byte-comparable.
 */

const CHART_HOST_IDS = Object.freeze(["chart-trend", "chart-mix"]);

export const REVIEW_RUNTIME_CHART_HOST_IDS = CHART_HOST_IDS;

const TREND_BASE = Object.freeze([117, 120, 123, 125, 126, 127, 128]);
const TREND_LIFTED = Object.freeze([117, 121, 124, 126, 128, 130, 131]);
const MIX_BASE = Object.freeze([46, 28, 16, 10]);
const MIX_SHIFTED = Object.freeze([38, 33, 19, 10]);

function chartScript({ animationMs, libraryDelayMs, trend, mix, inertComment }) {
  // A deterministic renderer standing in for a chart library: it starts late
  // (library fetch), animates for a bounded time, then draws the exact settled
  // frame once. Both sides receive identical parameters on purpose, so any
  // sampled asymmetry belongs to the capture pipeline, not to this fixture.
  return `${inertComment ? "/* chart bundle rev b */\n" : ""}(function () {
  var ANIMATION_MS = ${animationMs};
  var DELAY_MS = ${libraryDelayMs};
  var TREND = ${JSON.stringify(trend)};
  var MIX = ${JSON.stringify(mix)};
  function drawTrend(context, width, height, progress) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#e5e7f2";
    context.lineWidth = 1;
    for (var gridIndex = 0; gridIndex <= 4; gridIndex += 1) {
      var gridY = Math.round((height - 24) * gridIndex / 4) + 6;
      context.beginPath();
      context.moveTo(28, gridY);
      context.lineTo(width - 6, gridY);
      context.stroke();
    }
    var minimum = Math.min.apply(null, TREND) - 6;
    var maximum = Math.max.apply(null, TREND) + 4;
    var pointX = function (index) {
      return 28 + Math.round((width - 40) * index / (TREND.length - 1));
    };
    var pointY = function (value) {
      var ratio = (value - minimum) / (maximum - minimum);
      return Math.round((height - 30) * (1 - ratio)) + 6;
    };
    var visible = Math.max(2, Math.round(TREND.length * progress));
    context.beginPath();
    context.moveTo(pointX(0), pointY(TREND[0]));
    for (var index = 1; index < visible; index += 1) {
      context.lineTo(pointX(index), pointY(TREND[index]));
    }
    context.strokeStyle = "#6c5ce7";
    context.lineWidth = 2;
    context.stroke();
    context.lineTo(pointX(visible - 1), height - 18);
    context.lineTo(pointX(0), height - 18);
    context.closePath();
    context.fillStyle = "rgba(108, 92, 231, 0.22)";
    context.fill();
  }
  function drawMix(context, width, height, progress) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    var centerX = Math.round(width / 2);
    var centerY = Math.round(height / 2);
    var radius = Math.round(Math.min(width, height) / 2) - 10;
    var total = MIX.reduce(function (sum, value) { return sum + value; }, 0);
    var start = -Math.PI / 2;
    var palette = ["#6c5ce7", "#8f7ff0", "#b3a8f6", "#d8d2fb"];
    for (var index = 0; index < MIX.length; index += 1) {
      var sweep = (MIX[index] / total) * Math.PI * 2 * progress;
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.arc(centerX, centerY, radius, start, start + sweep);
      context.closePath();
      context.fillStyle = palette[index];
      context.fill();
      start += sweep;
    }
    context.beginPath();
    context.fillStyle = "#ffffff";
    context.arc(centerX, centerY, Math.round(radius * 0.58), 0, Math.PI * 2);
    context.fill();
  }
  function render(hostId, painter) {
    var host = document.getElementById(hostId);
    if (!host) return;
    // The library creates its own canvas, exactly like a real chart library:
    // the authored host stays empty in the source bytes, which is what the
    // owner's "host" binding requires.
    var canvas = document.createElement("canvas");
    canvas.width = host.clientWidth || 320;
    canvas.height = host.clientHeight || 200;
    host.appendChild(canvas);
    var context = canvas.getContext("2d");
    if (!context) return;
    var startedAt = null;
    var step = function (timestamp) {
      if (startedAt === null) startedAt = timestamp;
      var elapsed = timestamp - startedAt;
      if (elapsed >= ANIMATION_MS) {
        // Drawn exactly once at progress 1, so a settled pair is byte-equal.
        painter(context, canvas.width, canvas.height, 1);
        return;
      }
      painter(context, canvas.width, canvas.height, elapsed / ANIMATION_MS);
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }
  window.setTimeout(function () {
    render("${CHART_HOST_IDS[0]}", drawTrend);
    render("${CHART_HOST_IDS[1]}", drawMix);
  }, DELAY_MS);
})();`;
}

const STYLE_CHART_HOST = ".chart-host{width:320px;height:200px}";
const STYLE = [
  "body{margin:0;font-family:system-ui,sans-serif;color:#1f2333;background:#f6f7fb}",
  "main{padding:24px}",
  "section{background:#fff;border:1px solid #e8e9f2;border-radius:12px;padding:16px;margin-bottom:16px}",
  "h2{font-size:15px;margin:0 0 10px}",
  ".metrics{display:flex;gap:12px}",
  ".metric{flex:1;border:1px solid #eef0f7;border-radius:10px;padding:12px}",
  ".charts{display:flex;gap:16px}",
  STYLE_CHART_HOST,
  "canvas{display:block}",
  "footer{padding:16px 24px;color:#6b7080;font-size:12px}",
].join("");

function metricBlock(label, value, note) {
  return `<div class="metric"><p>${label}</p><strong>${value}</strong><p>${note}</p></div>`;
}

/**
 * Emits the page and the element-index path of every chart host from one
 * description, so a scenario that shifts blocks can never leave the census
 * bound to a stale path.
 */
function page({ blocks, footer, script }) {
  const bodyBlocks = [];
  const hostPaths = new Map();
  blocks.forEach((block, blockIndex) => {
    bodyBlocks.push(block.html);
    (block.hosts || []).forEach(({ id, path }) => {
      // html > body(1) > main(0) > block(blockIndex) > block-relative path
      hostPaths.set(id, Object.freeze([1, 0, blockIndex, ...path]));
    });
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>周度经营速览</title>`
    + `<style>${STYLE}</style></head><body><main>${bodyBlocks.join("")}</main>`
    + `<footer>${footer}</footer><script>${script}</script></body></html>`;
  return { html, hostPaths };
}

function summarySection(paragraph) {
  return {
    html: `<section><h2>核心结论</h2><p>${paragraph}</p>`
      + `<p>留存侧没有出现同步走弱，次日留存 41.7% 与上周持平。</p></section>`,
  };
}

function metricsSection() {
  return {
    html: `<section><h2>关键指标</h2><div class="metrics">`
      + metricBlock("周均日活", "128.4 万", "环比 +6.2%")
      + metricBlock("次日留存", "41.7%", "与上周基本持平")
      + metricBlock("周成交额", "3.86 亿元", "同比 +11.5%")
      + `</div></section>`,
  };
}

function chartsSection() {
  return {
    // section > h2(0), div.charts(1) > div.chart-host(0|1). Both hosts stay
    // empty in the source; the chart script fills them at runtime.
    hosts: [
      { id: CHART_HOST_IDS[0], path: [1, 0] },
      { id: CHART_HOST_IDS[1], path: [1, 1] },
    ],
    html: `<section><h2>趋势与构成</h2><div class="charts">`
      + `<div class="chart-host" id="${CHART_HOST_IDS[0]}"></div>`
      + `<div class="chart-host" id="${CHART_HOST_IDS[1]}"></div>`
      + `</div></section>`,
  };
}

function notesSection(items) {
  return {
    html: `<section><h2>观察与备注</h2><ul>`
      + items.map((item) => `<li>${item}</li>`).join("")
      + `</ul></section>`,
  };
}

function extraCard() {
  return {
    html: `<section><h2>实验效果概览</h2><p>灰度组转化率 3.24%，对照组 3.02%。</p>`
      + `<p>样本量 12.4 万，置信区间未跨零。</p></section>`,
  };
}

const BASE_SUMMARY = "本周日活规模继续扩大但增速放缓——周均日活 128.4 万，环比 +6.2%。";
const BASE_NOTES = Object.freeze([
  "列表项中的文字保持项目符号和缩进。",
  "搜索入口日活 42.1 万，份额收缩 1.8pp 至 32.8%。",
  "推荐位增长动能充足；仅私域与推荐保持份额增长。",
]);
const BASE_FOOTER = "口径说明：日活按去重设备统计，成交额选未结算订单。";

export const REVIEW_RUNTIME_CHART_SCENARIO_IDS = Object.freeze([
  "footer-only",
  "text-insert",
  "text-delete",
  "text-rewrite",
  "structure-add",
  "structure-remove",
  "chart-script-noop",
  "chart-data-change",
  "chart-host-resize",
]);

/**
 * Builds one scenario pair. `animationMs` and `libraryDelayMs` are applied
 * identically to both sides on purpose.
 */
export function reviewRuntimeChartScenario(id, { animationMs = 1_000, libraryDelayMs = 120 } = {}) {
  const script = (overrides = {}) => chartScript({
    animationMs,
    libraryDelayMs,
    trend: TREND_BASE,
    mix: MIX_BASE,
    inertComment: false,
    ...overrides,
  });
  const build = (blocks, footer, scriptOverrides) => page({
    blocks,
    footer,
    script: script(scriptOverrides),
  });
  const baseBlocks = () => [
    summarySection(BASE_SUMMARY),
    metricsSection(),
    chartsSection(),
    notesSection([...BASE_NOTES]),
  ];
  const withExtraCard = () => [
    summarySection(BASE_SUMMARY),
    metricsSection(),
    extraCard(),
    chartsSection(),
    notesSection([...BASE_NOTES]),
  ];

  switch (id) {
    case "footer-only":
      return {
        chartExpectation: "unchanged",
        before: build(baseBlocks(), BASE_FOOTER),
        after: build(baseBlocks(), "口径说明：日活按去重设备统计，成交额每周复核一次。"),
      };
    case "text-insert":
      return {
        chartExpectation: "unchanged",
        before: build(baseBlocks(), BASE_FOOTER),
        after: build([
          summarySection(BASE_SUMMARY),
          metricsSection(),
          chartsSection(),
          notesSection([...BASE_NOTES, "私域复购率环比提升 0.9pp，是本轮增量的主要来源。"]),
        ], BASE_FOOTER),
      };
    case "text-delete":
      return {
        chartExpectation: "unchanged",
        before: build(baseBlocks(), BASE_FOOTER),
        after: build([
          summarySection(BASE_SUMMARY),
          metricsSection(),
          chartsSection(),
          notesSection(BASE_NOTES.slice(0, 2)),
        ], BASE_FOOTER),
      };
    case "text-rewrite":
      return {
        chartExpectation: "unchanged",
        before: build(baseBlocks(), BASE_FOOTER),
        after: build([
          summarySection("本周日活稳步扩张而增速趋缓——周均日活 128.4 万，环比 +6.2%。"),
          metricsSection(),
          chartsSection(),
          notesSection([...BASE_NOTES]),
        ], BASE_FOOTER),
      };
    case "structure-add":
      // The inserted card sits above the charts, so the after side must scroll
      // a different distance to centre the same host.
      return {
        chartExpectation: "unchanged",
        before: build(baseBlocks(), BASE_FOOTER),
        after: build(withExtraCard(), BASE_FOOTER),
      };
    case "structure-remove":
      return {
        chartExpectation: "unchanged",
        before: build(withExtraCard(), BASE_FOOTER),
        after: build(baseBlocks(), BASE_FOOTER),
      };
    case "chart-script-noop":
      // Script bytes differ, the rendered result cannot.
      return {
        chartExpectation: "unchanged",
        before: build(baseBlocks(), BASE_FOOTER),
        after: build(baseBlocks(), BASE_FOOTER, { inertComment: true }),
      };
    case "chart-data-change":
      return {
        chartExpectation: "changed",
        before: build(baseBlocks(), BASE_FOOTER),
        after: build(baseBlocks(), BASE_FOOTER, { trend: TREND_LIFTED, mix: MIX_SHIFTED }),
      };
    case "chart-host-resize": {
      const after = build(baseBlocks(), BASE_FOOTER);
      return {
        chartExpectation: "changed",
        before: build(baseBlocks(), BASE_FOOTER),
        after: {
          ...after,
          html: after.html.replace(STYLE_CHART_HOST, ".chart-host{width:260px;height:200px}"),
        },
      };
    }
    default:
      throw new Error(`Unknown review runtime chart scenario: ${id}`);
  }
}
