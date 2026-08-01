import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";

function fail(message) {
  throw new Error(`[review-demo-fixtures] ${message}`);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) fail(`找不到“${label}”`);
  if (source.indexOf(before, first + before.length) >= 0) fail(`“${label}”出现多次`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replacePatternOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) fail(`“${label}”应命中 1 次，实际为 ${matches.length} 次`);
  return source.replace(pattern, replacement);
}

function sectionRange(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) fail(`无法定位“${label}”范围`);
  return { start, end };
}

function moveDashboardActivity(source) {
  const { start, end } = sectionRange(
    source,
    '<section class="section" id="dashboard"',
    "<!-- 03 Tabs + Long-form Article",
    "数据概览",
  );
  const section = source.slice(start, end);
  const chartToken = '<article class="panel chart-panel">';
  const activityToken = '<aside class="panel activity-panel"';
  const chartTokenIndex = section.indexOf(chartToken);
  const activityTokenIndex = section.indexOf(activityToken);
  const gridCloseToken = "\n          </div>\n        </div>\n      </section>";
  const gridClose = section.indexOf(gridCloseToken, activityTokenIndex);
  if (chartTokenIndex < 0 || activityTokenIndex < 0 || gridClose < 0 || activityTokenIndex < chartTokenIndex) {
    fail("数据概览中的图表与实时动态结构不符合预期");
  }
  const chartStart = section.lastIndexOf("\n", chartTokenIndex) + 1;
  const activityStart = section.lastIndexOf("\n", activityTokenIndex) + 1;
  const chart = section.slice(chartStart, activityStart).trimEnd();
  const activity = section.slice(activityStart, gridClose).trimEnd();
  const moved = `${section.slice(0, chartStart)}${activity}\n\n${chart}${section.slice(gridClose)}`;
  return `${source.slice(0, start)}${moved}${source.slice(end)}`;
}

function catalogCards(source) {
  const { start, end } = sectionRange(source, '<div class="catalog-grid" id="catalog-grid">', "<template id=\"catalog-card-template\">", "项目目录");
  const area = source.slice(start, end);
  const cards = [...area.matchAll(/            <article class="catalog-card"[\s\S]*?            <\/article>/g)].map((match) => match[0]);
  if (cards.length !== 6) fail(`项目目录应包含 6 张静态卡片，实际为 ${cards.length} 张`);
  const byTitle = new Map();
  for (const card of cards) {
    const title = card.match(/<h3>(.*?)<\/h3>/)?.[1];
    if (!title) fail("项目卡片缺少标题");
    byTitle.set(title, card);
  }
  const order = ["证据链版本引擎", "离线优先知识仓库", "未来工作方式观察站", "低视力阅读组件库", "城市慢行信息系统"];
  const newCard = `            <article class="catalog-card" data-category="system">
              <div class="card-image"><span aria-hidden="true">04</span></div>
              <div class="card-body">
                <div class="card-meta">
                  <span class="badge">系统 · System</span>
                  <time datetime="2030-05">2030 / 05</time>
                </div>
                <h3>跨端内容审阅器</h3>
                <p>把完整页面、内容地图、评论与差异判断放在同一个可核对、可追溯的审阅流程中。</p>
                <div class="price-row">
                  <data value="24800">预算 ¥24,800</data>
                  <button class="button small" type="button" data-toast="已收藏「跨端内容审阅器」">收藏</button>
                </div>
              </div>
            </article>`;
  const nextCards = [...order.slice(0, 3).map((title) => byTitle.get(title)), newCard, ...order.slice(3).map((title) => byTitle.get(title))]
    .map((card, index) => {
      if (!card) fail("项目目录排序时缺少卡片");
      return card.replace(/<span aria-hidden="true">\d+<\/span>/, `<span aria-hidden="true">0${index + 1}</span>`);
    })
    .join("\n\n");
  const newArea = `${area.slice(0, area.indexOf(cards[0]))}${nextCards}\n          </div>\n\n          `;
  return `${source.slice(0, start)}${newArea}${source.slice(end)}`;
}

function transformOperationRow(source, projectName, transform) {
  const { start, end } = sectionRange(source, '<table id="project-table">', "</table>", "项目执行表");
  const table = source.slice(start, end);
  const rows = [...table.matchAll(/                  <tr data-progress="\d+">[\s\S]*?                  <\/tr>/g)];
  const target = rows.find((row) => row[0].includes(`<th scope="row">${projectName}</th>`));
  if (!target) fail(`找不到项目行“${projectName}”`);
  const nextTable = table.replace(target[0], transform(target[0]));
  return `${source.slice(0, start)}${nextTable}${source.slice(end)}`;
}

export function createCandidate(baseline) {
  let candidate = baseline;

  candidate = replaceOnce(candidate, "<title>Atlas Lab 2030｜复杂 HTML 综合测试页</title>", "<title>Atlas Lab 2030｜真实修改候选版</title>", "页面标题");
  candidate = replaceOnce(candidate, '<h1><span>为复杂页面而生</span><em>数字实验场</em></h1>', '<h1><span>一次看清复杂页面</span><em>能不能被可靠修改</em></h1>', "开场主标题");
  candidate = replacePatternOnce(
    candidate,
    /            <p class="hero-lede"[\s\S]*?            <\/p>/,
    `            <p class="hero-lede">
              从数据看板、长文章、项目目录到表格和媒体，选择一个真实场景开始验证；没有被点名的内容会保持原样。
            </p>`,
    "开场说明",
  );
  candidate = replacePatternOnce(
    candidate,
    /            <div class="button-row">[\s\S]*?            <\/div>/,
    `            <div class="button-row">
              <a class="button" href="#dashboard">先看数据变化 <span aria-hidden="true">↓</span></a>
              <button class="button secondary" id="open-dialog" type="button">打开交互样本</button>
            </div>`,
    "开场操作区",
  );
  candidate = replacePatternOnce(
    candidate,
    /            <ul class="hero-note"[\s\S]*?            <\/ul>/,
    `            <ul class="hero-note" aria-label="本页内容摘要">
              <li>8 个主要内容区</li>
              <li>6 张项目卡片</li>
              <li>5 条运营项目</li>
              <li>表单、媒体与代码样本</li>
            </ul>`,
    "开场内容摘要",
  );
  candidate = replaceOnce(candidate, "<strong>48+</strong>\n              <span>种元素、状态与布局组合等待测试</span>", "<strong>7</strong>\n              <span>类真实修改等待逐项审阅</span>", "开场辅助说明");

  candidate = replaceOnce(candidate, '<article class="panel metric-card" data-card="north-star">', '<article class="panel metric-card featured-metric" data-card="north-star">', "主指标样式标记");
  candidate = replaceOnce(candidate, '<strong class="metric-value">87.4</strong>', '<strong class="metric-value">91.6</strong>', "健康度数字");
  candidate = replaceOnce(candidate, '<strong class="metric-value">18</strong>', '<strong class="metric-value">24</strong>', "活跃项目数字");
  candidate = replaceOnce(candidate, '<span class="trend">↑ 18 个</span>', '<span class="trend">↑ 6 个</span>', "活跃项目趋势");
  candidate = replaceOnce(candidate, '<strong class="metric-value">4.34534<small></small></strong>', '<strong class="metric-value">3.8<small> 天</small></strong>', "交付周期数字");
  candidate = replaceOnce(candidate, '<span class="trend down">↓ 0.7 天</span>', '<span class="trend down">↓ 0.5 天</span>', "交付周期趋势");
  candidate = replaceOnce(candidate, '<strong class="metric-value">76%</strong>', '<strong class="metric-value">81%</strong>', "自动化覆盖率数字");
  candidate = moveDashboardActivity(candidate);

  candidate = replaceOnce(
    candidate,
    "网页工具善于生成完整页面，可靠的编辑还要理解用户只想改哪里。\n                    <mark style=\"font-weight: normal; font-style: italic\">局部意图</mark>由目标、上下文和约束组成；边界明确，页面才能持续演进。",
    "网页工具不仅要生成完整页面，更要让人一眼看懂哪里变了。\n                    <mark>可审阅的修改</mark>需要同时交代内容、结构、行为，以及没有被改动的边界。",
    "文章开场文字",
  );
  candidate = replacePatternOnce(
    candidate,
    /                  <h3 id="article-context">[\s\S]*?                  <footer>\n                    <hr>/,
    `                  <h3 id="article-structure">一、先保证结构能够被可靠核对</h3>
                  <p>
                    HTML 不只是屏幕上的文字，还包含属性、注释、脚本和模板。可靠修改要做到：
                    <q>目标内的变化能解释，目标外保持不变，结果仍可独立打开。</q>
                  </p>

                  <blockquote cite="https://html.spec.whatwg.org/">
                    <p><strong>“让变化有边界，让未被请求的部分保持安静。”</strong></p>
                    <footer>— Atlas Lab，《<cite>局部编辑工作备忘录</cite>》</footer>
                  </blockquote>

                  <h3 id="article-context">二、再给每一次变化足够的上下文</h3>
                  <p>
                    <dfn id="term-actionable-context">可操作上下文</dfn>只保留目标、邻近内容、用户评论和禁止变化的范围，让审阅者不必理解源码也能作出判断。
                  </p>

                  <h3 id="article-culture">三、把一次修改变成持续协作</h3>
                  <p>
                    评论、直接修改和 AI 结果进入同一条历史链后，团队关注的是“为什么改”，而不是“哪份最新”。
                    <ins>可追溯上下文</ins>由此替代<del>散落的口头约定</del>。
                  </p>
                  <section class="article-checklist" aria-labelledby="article-checklist-title">
                    <h4 id="article-checklist-title">交付前验证清单</h4>
                    <ol>
                      <li>标题、数据和评论能一一对应</li>
                      <li>移动内容不会被误判为删除再新增</li>
                      <li>未修改区域仍能正常浏览和操作</li>
                    </ol>
                  </section>

                  <footer>
                    <hr>`,
    "文章章节重组",
  );
  candidate = replacePatternOnce(
    candidate,
    /                    <ol>\n                      <li><a href="#article-intro">[\s\S]*?                    <\/ol>/,
    `                    <ol>
                      <li><a href="#article-intro">开场：让修改可审阅</a></li>
                      <li><a href="#article-structure">结构保真</a></li>
                      <li><a href="#article-context">上下文边界</a></li>
                      <li><a href="#article-culture">持续协作</a></li>
                    </ol>`,
    "文章目录",
  );

  candidate = catalogCards(candidate);

  candidate = replaceOnce(candidate, '<th scope="col">风险</th>', '<th scope="col">下一动作</th>', "运营表格末列表头");
  candidate = transformOperationRow(candidate, "证据链版本引擎", (row) => row
    .replace('data-progress="84"', 'data-progress="88"')
    .replace('value="84">84%', 'value="88">88%')
    .replace("<td>中</td>", "<td>准备上线检查</td>"));
  candidate = transformOperationRow(candidate, "低视力阅读组件库", (row) => row
    .replace('data-progress="62"', 'data-progress="71"')
    .replace('<span class="status warning">待复核</span>', '<span class="status">进行中</span>')
    .replace('value="62">62%', 'value="71">71%')
    .replace("<td>高</td>", "<td>补齐键盘测试</td>"));
  candidate = transformOperationRow(candidate, "未来工作方式观察站", (row) => row.replace("<td>低</td>", "<td>冻结访谈样本</td>"));
  candidate = transformOperationRow(candidate, "离线优先知识仓库", (row) => row
    .replace('data-progress="18"', 'data-progress="34"')
    .replace('<span class="status danger">已阻塞</span>', '<span class="status">进行中</span>')
    .replace('value="18">18%', 'value="34">34%')
    .replace("<td>高</td>", "<td>确认缓存策略</td>"));
  candidate = transformOperationRow(candidate, "城市慢行信息系统", () => `                  <tr data-progress="12">
                    <th scope="row">跨端内容审阅器</th>
                    <td><span class="person"><span class="avatar" style="background: #6a55a1">QY</span>秦予</span></td>
                    <td><span class="status warning">待启动</span></td>
                    <td><progress max="100" value="12">12%</progress></td>
                    <td><time datetime="2030-07-12">07 月 12 日</time></td>
                    <td>分配负责人</td>
                  </tr>`);
  candidate = replaceOnce(candidate, "平均完成度：62%", "平均完成度：50%", "运营表格平均完成度");

  candidate = replaceOnce(
    candidate,
    '<input type="hidden" name="fixture-version" value="1.0.0">',
    `<input type="hidden" name="fixture-version" value="1.1.0">

              <ol class="review-form-steps" aria-label="填写步骤">
                <li aria-current="step"><span>1</span>联系人</li>
                <li><span>2</span>项目偏好</li>
                <li><span>3</span>确认提交</li>
              </ol>`,
    "表单步骤",
  );
  candidate = replaceOnce(candidate, "<legend>基本信息</legend>", "<legend>第一步 · 联系人</legend>", "表单第一步");
  candidate = replaceOnce(candidate, "<legend>日期、数值与偏好</legend>", "<legend>第二步 · 项目偏好</legend>", "表单第二步");
  candidate = replaceOnce(candidate, "<legend>选择与附件</legend>", "<legend>第三步 · 确认提交</legend>", "表单第三步");
  candidate = replaceOnce(candidate, "<legend>补充说明</legend>", "<legend>补充说明 · 可选</legend>", "表单补充说明");
  candidate = replacePatternOnce(
    candidate,
    /(                  <div class="field">\n                    <label for="budget">[\s\S]*?                  <\/div>)(\n                  <div class="field full">)/,
    `$1
                  <div class="field" id="approval-note-wrap" hidden>
                    <label for="approval-note">高预算审批说明 *</label>
                    <input id="approval-note" name="approval-note" type="text" placeholder="请说明预算依据">
                    <small>预算达到 ¥20,000 后需要填写。</small>
                  </div>$2`,
    "高预算审批说明",
  );
  candidate = replaceOnce(
    candidate,
    `              <div class="form-actions">
                <button class="button" type="submit">模拟提交</button>
                <button class="button secondary" type="reset">重置表单</button>
                <input class="button ghost" type="button" id="save-draft" value="保存草稿">
              </div>`,
    `              <div class="form-actions">
                <button class="button" type="submit">检查并提交</button>
                <button class="button secondary" type="reset">重置表单</button>
                <input class="button ghost" type="button" id="save-draft" value="保存草稿">
              </div>
              <p class="form-feedback" id="form-feedback" role="status" hidden></p>`,
    "表单提交反馈",
  );

  const { start: galleryStart, end: galleryEnd } = sectionRange(candidate, '<div class="gallery-grid">', "<div class=\"media-lab\">", "媒体画廊");
  const galleryArea = candidate.slice(galleryStart, galleryEnd);
  const figures = [...galleryArea.matchAll(/            <figure class="gallery-item[\s\S]*?            <\/figure>/g)].map((match) => match[0]);
  if (figures.length !== 4) fail(`媒体画廊应包含 4 项，实际为 ${figures.length} 项`);
  const figureByTitle = new Map(figures.map((figure) => [figure.match(/<strong>(.*?)<\/strong>/)?.[1], figure]));
  const galleryOrder = ["图片元素样本", "潮汐档案", "地表纹理", "风向记录"];
  const nextGallery = galleryOrder.map((title) => {
    const figure = figureByTitle.get(title);
    if (!figure) fail(`媒体画廊缺少“${title}”`);
    if (title === "潮汐档案") return figure.replace('class="gallery-item wide tall"', 'class="gallery-item tall"');
    return figure;
  }).join("\n");
  candidate = `${candidate.slice(0, galleryStart)}<div class="gallery-grid">\n${nextGallery}\n          </div>\n\n          ${candidate.slice(galleryEnd)}`;
  candidate = replaceOnce(candidate, '<audio controls preload="none">', '<div class="media-status" data-media-status><span aria-hidden="true"></span><strong>正在检查媒体连接</strong><button type="button" data-retry-media>重新检查</button></div>\n              <audio controls preload="none">', "音频状态");
  candidate = replaceOnce(candidate, '<video controls muted playsinline preload="metadata">', '<div class="media-status" data-media-status><span aria-hidden="true"></span><strong>正在检查媒体连接</strong><button type="button" data-retry-media>重新检查</button></div>\n                <video controls muted playsinline preload="metadata">', "视频状态");
  candidate = replaceOnce(candidate, "图片左、右区域分别链接到不同模块", "图片上、下区域分别链接到不同模块", "Image Map 说明");
  candidate = replaceOnce(candidate, "左侧绿色区域链接数据总览，右侧橙色区域链接项目目录", "上半区域链接数据总览，下半区域链接项目目录", "Image Map 替代文字");
  candidate = replaceOnce(candidate, '<area shape="rect" coords="0,0,320,240" href="#dashboard" alt="前往数据总览">\n                <area shape="rect" coords="320,0,640,240" href="#catalog" alt="前往项目目录">', '<area shape="rect" coords="0,0,640,120" href="#dashboard" alt="前往数据总览">\n                <area shape="rect" coords="0,120,640,240" href="#catalog" alt="前往项目目录">', "Image Map 热区");

  const candidateCss = `
      /* Candidate V1.4: simulated review changes. */
      .featured-metric { grid-column: span 6; border-color: color-mix(in srgb, var(--brand), transparent 48%); background: var(--brand-soft); }
      .featured-metric .metric-value { color: var(--brand-strong); }
      [data-card="active-projects"], [data-card="cycle-time"], [data-card="automation"] { grid-column: span 2; }
      .dashboard-grid > .activity-panel { grid-column: span 5; }
      .dashboard-grid > .chart-panel { grid-column: span 7; }
      .article-checklist { margin-top: 24px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-muted); }
      .article-checklist h4 { margin: 0 0 10px; }
      .article-checklist ol { margin-bottom: 0; }
      .review-form-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 28px; padding: 0; list-style: none; }
      .review-form-steps li { display: flex; align-items: center; gap: 8px; padding: 10px; border-radius: 10px; background: var(--surface-muted); color: var(--ink-soft); font-size: .78rem; font-weight: 760; }
      .review-form-steps li[aria-current="step"] { background: var(--brand-soft); color: var(--brand-strong); }
      .review-form-steps span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: var(--surface-solid); }
      .form-feedback { margin: 14px 0 0; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--success), transparent 60%); border-radius: 10px; background: color-mix(in srgb, var(--success), transparent 90%); color: var(--success); font-weight: 760; }
      .media-status { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-muted); font-size: .75rem; }
      .media-status span { width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
      .media-status[data-offline="true"] span { background: var(--danger); }
      .media-status strong { flex: 1; }
      .media-status button { border: 0; background: transparent; color: var(--brand-strong); font: inherit; font-weight: 800; cursor: pointer; }
`;
  candidate = replaceOnce(candidate, "    </style>", `${candidateCss}    </style>`, "候选版补充样式");

  candidate = replaceOnce(
    candidate,
    `        const confidence = document.querySelector("#confidence");
        const confidenceOutput = document.querySelector("#confidence-output");`,
    `        const confidence = document.querySelector("#confidence");
        const confidenceOutput = document.querySelector("#confidence-output");
        const budget = document.querySelector("#budget");
        const approvalNoteWrap = document.querySelector("#approval-note-wrap");
        const approvalNote = document.querySelector("#approval-note");
        const formFeedback = document.querySelector("#form-feedback");

        function syncBudgetApproval() {
          const needsApproval = ["large", "enterprise"].includes(budget.value);
          approvalNoteWrap.hidden = !needsApproval;
          approvalNote.required = needsApproval;
          if (!needsApproval) approvalNote.value = "";
        }

        budget.addEventListener("change", syncBudgetApproval);
        syncBudgetApproval();`,
    "表单即时关系脚本",
  );
  candidate = replaceOnce(
    candidate,
    `        document.querySelector("#test-form").addEventListener("submit", (event) => {
          event.preventDefault();
          showToast("表单校验通过；本测试页未向网络提交数据");
        });`,
    `        document.querySelector("#test-form").addEventListener("submit", (event) => {
          event.preventDefault();
          formFeedback.hidden = false;
          formFeedback.textContent = "信息已检查完成；这是演示页面，不会向网络提交数据。";
          showToast("表单检查完成");
        });`,
    "表单提交脚本",
  );
  candidate = replaceOnce(candidate, "confidenceOutput.value = confidence.value;\n            showToast(\"表单已恢复默认值\");", "confidenceOutput.value = confidence.value;\n            syncBudgetApproval();\n            formFeedback.hidden = true;\n            showToast(\"表单已恢复默认值\");", "表单重置脚本");
  candidate = replaceOnce(candidate, "// Canvas：使用 CSS 变量颜色，随主题与窗口宽度重绘。\n        function drawCanvas()", "// Canvas：使用 CSS 变量颜色，随主题与窗口宽度重绘，并保留用户选中的点位。\n        let selectedSignalRatio = 0.42;\n        function drawCanvas()", "Canvas 点位状态");
  candidate = replaceOnce(
    candidate,
    `          drawWave(brand, 44, 0.032, 0);
          drawWave(accent, 27, 0.046, 1.7);
          context.fillStyle = inkSoft;`,
    `          drawWave(brand, 44, 0.032, 0);
          drawWave(accent, 27, 0.046, 1.7);
          const markerX = Math.max(16, Math.min(width - 16, width * selectedSignalRatio));
          context.beginPath();
          context.fillStyle = brand;
          context.arc(markerX, height / 2, 6, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = styles.getPropertyValue("--surface-solid").trim();
          context.lineWidth = 3;
          context.stroke();
          context.fillStyle = inkSoft;`,
    "Canvas 点位绘制",
  );
  candidate = replaceOnce(
    candidate,
    `        drawCanvas();
        let resizeTimer;`,
    `        drawCanvas();
        document.querySelector("#signal-canvas").addEventListener("click", (event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          selectedSignalRatio = (event.clientX - rect.left) / rect.width;
          drawCanvas();
          showToast("已保留当前波形点位");
        });

        function updateMediaStatus() {
          document.querySelectorAll("[data-media-status]").forEach((status) => {
            status.dataset.offline = String(!navigator.onLine);
            status.querySelector("strong").textContent = navigator.onLine ? "媒体连接可用" : "当前离线，其他内容仍可浏览";
          });
        }
        window.addEventListener("online", updateMediaStatus);
        window.addEventListener("offline", updateMediaStatus);
        document.querySelectorAll("[data-retry-media]").forEach((button) => button.addEventListener("click", updateMediaStatus));
        updateMediaStatus();

        let resizeTimer;`,
    "Canvas 与媒体交互脚本",
  );

  return candidate;
}

export function validateDocuments(baseline, candidate) {
  if (!baseline.trimStart().toLowerCase().startsWith("<!doctype html>")) fail("原版不是完整 HTML 文档");
  if (!candidate.trimStart().toLowerCase().startsWith("<!doctype html>")) fail("候选版不是完整 HTML 文档");
  if (candidate === baseline) fail("候选版与原版完全相同");
  const parsedBefore = parse(baseline);
  const parsedAfter = parse(candidate);
  if (!parsedBefore.childNodes?.length || !parsedAfter.childNodes?.length) fail("HTML 解析结果为空");
  for (const anchor of ["top", "dashboard", "story", "catalog", "operations", "form-lab", "media", "documentation", "faq"]) {
    if (!baseline.includes(`id="${anchor}"`) || !candidate.includes(`id="${anchor}"`)) fail(`缺少页面锚点“${anchor}”`);
  }
}

async function main() {
  const [inputPath, outputDirectory] = process.argv.slice(2);
  if (!inputPath || !outputDirectory) fail("用法：node scripts/generate-review-demo-fixtures.mjs <input.html> <output-dir>");
  const baseline = await readFile(path.resolve(inputPath), "utf8");
  const candidate = createCandidate(baseline);
  validateDocuments(baseline, candidate);
  const destination = path.resolve(outputDirectory);
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(path.join(destination, "before.html"), baseline),
    writeFile(path.join(destination, "after.html"), candidate),
    writeFile(path.join(destination, "manifest.json"), `${JSON.stringify({
      sourceSha256: createHash("sha256").update(baseline).digest("hex"),
      candidateSha256: createHash("sha256").update(candidate).digest("hex"),
      sourceBytes: Buffer.byteLength(baseline),
      candidateBytes: Buffer.byteLength(candidate),
      changedAreas: ["top", "dashboard", "story", "catalog", "operations", "form-lab", "media"],
    }, null, 2)}\n`),
  ]);
  process.stdout.write(`已生成真实审阅资产：${destination}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
