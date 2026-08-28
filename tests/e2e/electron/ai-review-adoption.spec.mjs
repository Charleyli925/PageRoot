import { expect, test } from "@playwright/test";
import {
  LINE_SCOPE_AFTER,
  LINE_SCOPE_BEFORE,
  ORIGINAL_TEXT,
  OUTSIDE_MAIN_AFTER,
  OUTSIDE_MAIN_BEFORE,
  PICKER_TEXT,
  READABLE_REWRITE_AFTER,
  READABLE_REWRITE_BEFORE,
  REVIEW_MASK_UNION_AFTER,
  REVIEW_MASK_UNION_BEFORE,
  REVIEW_METRIC_AFTER_CSS,
  REVIEW_METRIC_BEFORE_CSS,
  REVIEW_PROJECTION_CASES,
  SCOPE_PROMOTION_AFTER,
  SCOPE_PROMOTION_BEFORE,
  SECOND_UPDATED_TEXT,
  UPDATED_TEXT,
  addCommentAndSubmit,
  adoptReadyResult,
  assertOverlayMaskEquivalence,
  assertProjectionGeometryCase,
  assertReviewAcceptPersistence,
  assertReviewChangeOutline,
  assertReviewControlDefaults,
  assertReviewHasNoRuntimeVisualSupplement,
  caseSelector,
  candidateHtmlFiles,
  closePageRootGracefully,
  createSourceFixture,
  existsSync,
  focusChangeById,
  fixtureBuffer,
  launchPageRoot,
  loadedDiskFrame,
  managedProjectRootForId,
  mkdirSync,
  removeAiLoopUserData,
  removeSourceFixture,
  path,
  productRoot,
  readFileSync,
  realpathSync,
  rmSync,
  runOfficialFinalizer,
  stopPageRoot,
  workingHtmlFiles,
  writeAiOutput,
  writeFileSync,
} from "./ai-closed-loop-helpers.mjs";

test("a verified AI result stays pending through desktop review until the user accepts it", {
  tag: ["@gate-smoke","@smoke-review"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("generated-ai-loop.html", (source) => source.replace(
    "  </main>",
    `    <style data-review-metric-theme>${REVIEW_METRIC_BEFORE_CSS}    </style>
    <section data-review-regression>
      <h2>核心结论</h2>
      <div data-review-regression-summary>在守住 EBITA 率底线的基础上，锁单确收实现 +8.52% 增长；21 天日均增量 +4.12 万，累计增量 +86.6 万。</div>
      <div data-review-semantic-copy>而非「让每个商品卖得更好」（品均基本持平）。这说明增长主要来自有效成交覆盖扩大。</div>
      <div data-review-readable-rewrite style="width: 360px; line-height: 1.7">${READABLE_REWRITE_BEFORE}</div>
      <p data-review-line-scope style="width: 360px; white-space: nowrap; line-height: 1.7">${LINE_SCOPE_BEFORE}</p>
      <p data-review-scope-promotion style="width: 360px; line-height: 1.7">${SCOPE_PROMOTION_BEFORE}</p>
      <p data-review-layout-only style="width: 240px; padding: 4px; border: 1px solid #c9ceda">同一段文字保持不变<br>只是换行位置调整。</p>
      <p data-review-cross-line style="width: 150px; line-height: 1.6">稳定前缀，稳定后缀。</p>
      <p data-review-stable-sentence-rewrite style="width: 150px; line-height: 1.6">稳定前句。旧方案覆盖多个指标、多个渠道、多个阶段，并给出较长说明。稳定后句。</p>
      <style data-review-marker-style>[data-review-injection-stability] span { display:block !important; padding:9px !important; }</style>
      <style data-review-projection-style>div, svg { outline:7px solid rgb(255 0 153) !important; }</style>
      <p data-review-injection-stability><span data-review-stable-left>稳定左侧</span><strong>旧词</strong><em data-review-stable-right>稳定右侧</em></p>
      <p class="review-comment-ordinary-target">普通段落评论定位保持独立。</p>
      <script>
        const ordinaryCommentTarget = document.querySelector(".review-comment-ordinary-target");
        const ordinaryCommentSibling = document.createElement("p");
        ordinaryCommentSibling.className = ordinaryCommentTarget.className;
        ordinaryCommentSibling.textContent = "运行时插入的同类段落";
        ordinaryCommentTarget.before(ordinaryCommentSibling);
      </script>
      <div data-review-metrics>
        <article data-review-metric="lock"><strong>+8.52%</strong><span>锁单确收增幅（显著 p&lt;0.01）</span><small>日均 52.5 万 vs 48.4 万</small></article>
        <article data-review-metric="ipv"><strong>+4.49%</strong><span>IPV 增幅（显著 p&lt;0.01）</span><small>日均 63.4 万 vs 60.7 万</small></article>
        <article data-review-metric="cvr"><strong>+6.85%</strong><span>CVR 增幅（显著 p&lt;0.01）</span><small>0.217% vs 0.203%</small></article>
      </div>
      <div data-review-inherited-copy style="width: 420px; padding: 24px; border: 2px solid #b8b8c7">内容级视觉调整</div>
      <div data-review-logical-card style="padding: 12px; border: 2px solid #b8b8c7">逻辑尺寸视觉调整</div>
${REVIEW_MASK_UNION_BEFORE}
      <div data-review-atomic-media style="display:flex;align-items:center;gap:6px">
        <span data-review-atomic-stable-before>稳定媒体前文。</span>
        <img data-review-atomic-removed alt="旧品牌图示" src="data:image/svg+xml,%3Csvg/%3E" width="28" height="20">
        <svg data-review-atomic-paired role="img" aria-label="趋势图" width="30" height="20" viewBox="0 0 30 20" fill="#8aa4c8"></svg>
        <input data-review-atomic-input name="品牌标识" type="text" value="品牌甲" style="width:60px;border:1px solid #9aa4b2">
        <span data-review-atomic-stable-after>稳定媒体后文。</span>
      </div>
      <div data-review-mixed-copy>
        <p data-review-reference>参考：示例日均确收约207万，增量4.12万/天约占2.0%。</p>
        <p data-review-delete-only>实验结果稳定。换言之，策略有效。</p>
        <p data-review-warning>⚠️ 近6天(7/23-<span><strong>7/28)增幅收窄至负值区间，需</strong></span>持续关注。</p>
      </div>
      <div data-review-numbered-lines>① 业务盘子：整体规模稳定。<br>② 实验贡献：日均增量明确。<br>③ 经营解读：效率保持稳定。</div>
      <ol data-review-list-items>
        <li>业务盘子稳定</li><li>实验贡献明确<ul data-review-nested-list><li>嵌套稳定项</li></ul></li><li>经营效率稳定</li>
      </ol>
      <table data-review-brand-table style="table-layout:fixed;width:210px;word-break:break-all">
        <thead><tr><th style="width:42px">品牌</th><th>类目</th><th>对照组</th></tr></thead>
        <tbody>
          <tr data-review-brand-row="alpha"><td>品牌甲</td><td>类目一</td><td>3.7万</td></tr>
          <tr data-review-brand-row="beta"><td>品牌乙</td><td>类目二</td><td>1.4万</td></tr>
          <tr data-review-brand-row="gamma"><td>品牌丙</td><td>类目三</td><td>2.3万</td></tr>
          <tr data-review-brand-row="delta"><td>品牌丁</td><td>类目二</td><td>3.7万</td></tr>
        </tbody>
      </table>
      <div data-review-break-layout><span>日均63<br><br>.4万<br>60.7万</span></div>
      <div data-review-deleted-copy><strong>品均拆解：</strong>总确收增长来自覆盖扩大。<br>待删除第一行<br>待删除第二行<br>待删除第三行<br>AI托管的核心价值保持不变。</div>
    </section>
    <section data-review-ebita-section>
      <h2>3EBITA分析</h2>
      <div data-review-ebita-copy><strong>结论：</strong>EBITA差异均在波动范围<br>内（0.06~0.13pt），AI托管未恶化盈利能力。</div>
    </section>
    <section data-review-anchor-only-section>
      <h2>删除锚点导航</h2>
      <div style="height:280px" aria-hidden="true"></div>
      <p data-review-anchor-only style="line-height:48px">稳定开头。<br>稳定中段。<br>只删除这句定位文字。稳定结尾。</p>
      <div style="height:360px" aria-hidden="true"></div>
    </section>
    <div class="tabs" role="tablist" aria-label="Review interaction fixture">
      <button type="button" data-review-tab-button data-p="review-p1">审阅标签一</button>
      <button type="button" data-review-tab-button data-p="review-p2">审阅标签二</button>
    </div>
    <div data-review-priority><strong>优先顺序：</strong>先处理稳定性，再补齐体验细节。</div>
    <button type="button" id="review-counter" data-review-counter>交互计数 <span>0</span></button>
    <input id="review-sync-input" aria-label="审阅同步输入" value="">
    <div class="panel" id="review-p1" data-review-tab-panel="one">
      <article id="review-tab-one-overview"><h2>标签一概览</h2><p>第一块完整内容</p></article>
      <article id="review-tab-one-detail"><h2>标签一详情</h2><p>第二块完整内容</p></article>
    </div>
    <div class="panel" id="review-p2" data-review-tab-panel="two" hidden>
      <article><h2>标签二概览</h2><p>第三块完整内容</p></article>
      <article><h2>标签二详情</h2><p>第四块完整内容</p></article>
    </div>
    <div class="panels" data-review-anonymous-panels>
      <div class="panel" role="tabpanel"><article><p data-review-anonymous-panel-copy="one">匿名面板甲内容</p></article><article><p>匿名面板稳定说明</p></article></div>
      <div class="panel" role="tabpanel"><article><p data-review-anonymous-panel-copy="two">匿名面板乙内容</p></article><article><p>匿名面板稳定说明</p></article></div>
    </div>
    <div class="indexed-review-tabs">
      <button type="button" class="indexed-review-tab active" onclick="switchIndexedReviewTab(0)">分行业表现</button>
      <button type="button" class="indexed-review-tab" onclick="switchIndexedReviewTab(1)">抖音搜盘表现</button>
    </div>
    <div class="indexed-review-panels">
      <section id="indexed-review-panel-one" class="indexed-review-panel active" style="display: block; min-height: 240px">
        <h2>分行业表现</h2><p>索引式页签第一页</p>
      </section>
      <section id="indexed-review-panel-two" class="indexed-review-panel" style="display: none; min-height: 960px">
        <h2>抖音搜盘表现</h2><p>索引式页签第二页</p>
      </section>
    </div>
    <script>
      document.querySelectorAll("[data-review-tab-button]").forEach((button) => {
        button.addEventListener("click", () => {
          document.querySelectorAll("[data-review-tab-panel]").forEach((panel) => {
            panel.hidden = panel.id !== button.dataset.p;
          });
        });
      });
      document.querySelector("[data-review-counter]").addEventListener("click", (event) => {
        const button = event.currentTarget;
        const nextCount = Number(button.dataset.count || 0) + 1;
        button.dataset.count = String(nextCount);
        button.querySelector("span").textContent = String(nextCount);
      });
      function switchIndexedReviewTab(activeIndex) {
        document.querySelectorAll(".indexed-review-tab").forEach((tab, index) => {
          tab.classList.toggle("active", index === activeIndex);
        });
        document.querySelectorAll(".indexed-review-panel").forEach((panel, index) => {
          panel.classList.toggle("active", index === activeIndex);
          panel.style.display = index === activeIndex ? "block" : "none";
        });
      }
      document.documentElement.dataset.reviewFixtureReady = "true";
    </script>
  </main>`,
  ));
  const pickerSourcePath = path.join(fixture.sourceDirectory, "picker-target.html");
  writeFileSync(
    pickerSourcePath,
    fixtureBuffer("complex-layout.html")
      .toString("utf8")
      .replace(ORIGINAL_TEXT, PICKER_TEXT),
    "utf8",
  );
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  const ordinaryReviewCommentText = "这个普通段落也请保留。";
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
      UPDATED_TEXT,
      [{
        text: ordinaryReviewCommentText,
        targetSelector: ".review-comment-ordinary-target",
      }],
    );
    const attemptRoot = path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
    );
    writeFileSync(path.join(attemptRoot, ".DS_Store"), "Finder metadata");
    writeFileSync(
      path.join(attemptRoot, "output", ".DS_Store"),
      "Finder metadata",
    );
    await launched.page.waitForTimeout(3_500);
    // The stages are narrated in the conversation now; the process panel is out of the
    // user flow, so its board no longer exists to assert against.
    const runProgress = launched.page.getByTestId("ai-conversation-run-progress");
    await expect(runProgress).toContainText("等待你的 AI 完成修改");
    await expect(runProgress.locator("li")).toHaveCount(0);
    writeAiOutput(request.requestRoot, (base) => {
      expect(base.match(new RegExp(ORIGINAL_TEXT, "gu"))).toHaveLength(1);
      return base
        .replace(ORIGINAL_TEXT, UPDATED_TEXT)
        .replace(REVIEW_METRIC_BEFORE_CSS, REVIEW_METRIC_AFTER_CSS)
        .replace(REVIEW_MASK_UNION_BEFORE, REVIEW_MASK_UNION_AFTER)
        .replace(
          "      <div data-review-regression-summary>",
          `      <div data-review-added-chart>
        <strong>实验效果概览</strong>
        <div><span>锁单确收</span><progress max="100" value="82"></progress></div>
        <div><span>CVR</span><progress max="100" value="69"></progress></div>
        <p>读图：规模增长由转化效率提升与动销覆盖扩大共同驱动。</p>
      </div>
      <div data-review-regression-summary>`,
        )
        .replace(
          '    <div data-review-priority><strong>优先顺序：</strong>先处理稳定性，再补齐体验细节。</div>\n',
          "",
        )
        .replace(
          '<p data-review-reference>参考：示例日均确收约207万，增量4.12万/天约占2.0%。</p>',
          '<p data-review-reference>参考：示例日均确收约207万，本实验增量4.12万/天约占2.0%。</p>',
        )
        .replace(
          '<p data-review-delete-only>实验结果稳定。换言之，策略有效。</p>',
          '<p data-review-delete-only>实验结果稳定。策略有效。</p>',
        )
        .replace(
          '<div data-review-numbered-lines>① 业务盘子：整体规模稳定。<br>② 实验贡献：日均增量明确。<br>③ 经营解读：效率保持稳定。</div>',
          '<div data-review-numbered-lines>① 业务盘子：整体规模稳定。<br>② 实验贡献：日均增量明确。<br>③ 经营解读：效率保持稳定。<br>④ 后续重点：继续观察新增商品。</div>',
        )
        .replace(
          '        <li>业务盘子稳定</li><li>实验贡献明确<ul data-review-nested-list><li>嵌套稳定项</li></ul></li><li>经营效率稳定</li>',
          '        <li>业务盘子稳定</li><li>实验贡献明确<ul data-review-nested-list><li>嵌套稳定项</li></ul></li><li>经营效率稳定</li><li data-review-added-list-item>后续观察新增商品</li>',
        )
        .replace(
          '          <tr data-review-brand-row="gamma"><td>品牌丙</td><td>类目三</td><td>2.3万</td></tr>',
          `          <tr data-review-brand-row="added"><td>品牌新增</td><td>类目二</td><td>1.4万</td></tr>
          <tr data-review-brand-row="gamma"><td>品牌丙</td><td>类目三</td><td>2.3万</td></tr>`,
        )
        .replace(
          '<div data-review-semantic-copy>而非「让每个商品卖得更好」（品均基本持平）。这说明增长主要来自有效成交覆盖扩大。</div>',
          '<div data-review-semantic-copy>而非「让每个商品卖得更好」（单品效率整体稳定，增幅仅+0.10%）。这说明增长主要来自有效成交覆盖扩大。</div>',
        )
        .replace(
          `<div data-review-readable-rewrite style="width: 360px; line-height: 1.7">${READABLE_REWRITE_BEFORE}</div>`,
          `<div data-review-readable-rewrite style="width: 360px; line-height: 1.7">${READABLE_REWRITE_AFTER}</div>`,
        )
        .replace(
          `<p data-review-line-scope style="width: 360px; white-space: nowrap; line-height: 1.7">${LINE_SCOPE_BEFORE}</p>`,
          `<p data-review-line-scope style="width: 360px; white-space: nowrap; line-height: 1.7">${LINE_SCOPE_AFTER}</p>`,
        )
        .replace(
          `<p data-review-scope-promotion style="width: 360px; line-height: 1.7">${SCOPE_PROMOTION_BEFORE}</p>`,
          `<p data-review-scope-promotion style="width: 360px; line-height: 1.7">${SCOPE_PROMOTION_AFTER}</p>`,
        )
        .replace(
          '<p data-review-layout-only style="width: 240px; padding: 4px; border: 1px solid #c9ceda">同一段文字保持不变<br>只是换行位置调整。</p>',
          '<p data-review-layout-only style="width: 240px; padding: 14px; border: 3px solid #6d5ce7">同一段文字保持不变只是<br>换行位置调整。</p>',
        )
        .replace(
          '<p data-review-cross-line style="width: 150px; line-height: 1.6">稳定前缀，稳定后缀。</p>',
          '<p data-review-cross-line style="width: 150px; line-height: 1.6">稳定前缀，新增说明需要跨越多个实际文字行并合并为一个框，稳定后缀。</p>',
        )
        .replace(
          '<p data-review-stable-sentence-rewrite style="width: 150px; line-height: 1.6">稳定前句。旧方案覆盖多个指标、多个渠道、多个阶段，并给出较长说明。稳定后句。</p>',
          '<p data-review-stable-sentence-rewrite style="width: 150px; line-height: 1.6">稳定前句。新方案改写全部口径、执行路径、验证方式，并补充另一组较长说明。稳定后句。</p>',
        )
        .replace(
          '<p data-review-injection-stability><span data-review-stable-left>稳定左侧</span><strong>旧词</strong><em data-review-stable-right>稳定右侧</em></p>',
          '<p data-review-injection-stability><span data-review-stable-left>稳定左侧</span><strong>新词</strong><em data-review-stable-right>稳定右侧</em></p>',
        )
        .replace(
          `      <div data-review-atomic-media style="display:flex;align-items:center;gap:6px">
        <span data-review-atomic-stable-before>稳定媒体前文。</span>
        <img data-review-atomic-removed alt="旧品牌图示" src="data:image/svg+xml,%3Csvg/%3E" width="28" height="20">
        <svg data-review-atomic-paired role="img" aria-label="趋势图" width="30" height="20" viewBox="0 0 30 20" fill="#8aa4c8"></svg>
        <input data-review-atomic-input name="品牌标识" type="text" value="品牌甲" style="width:60px;border:1px solid #9aa4b2">
        <span data-review-atomic-stable-after>稳定媒体后文。</span>
      </div>`,
          `      <div data-review-atomic-media style="display:flex;align-items:center;gap:6px">
        <span data-review-atomic-stable-before>稳定媒体前文。</span>
        <canvas data-review-atomic-added aria-label="新增画布图" width="28" height="20"></canvas>
        <svg data-review-atomic-paired role="img" aria-label="趋势图" width="30" height="20" viewBox="0 0 30 20" fill="#d26a81"></svg>
        <input data-review-atomic-input name="品牌标识" type="text" value="品牌甲" style="width:60px;border:3px solid #6d5ce7">
        <span data-review-atomic-stable-after>稳定媒体后文。</span>
      </div>`,
        )
        .replace(
          '<p data-review-warning>⚠️ 近6天(7/23-<span><strong>7/28)增幅收窄至负值区间，需</strong></span>持续关注。</p>',
          '<p data-review-warning>⚠️ 近6天（7/23—<strong>7/28）增幅收窄至负值区间，需</strong>持续关注定价调整和转化波动。</p>',
        )
        .replace(
          '<div data-review-break-layout><span>日均63<br><br>.4万<br>60.7万</span></div>',
          '<div data-review-break-layout>日均63.4万 vs 60.7万</div>',
        )
        .replace(
          '<div data-review-deleted-copy><strong>品均拆解：</strong>总确收增长来自覆盖扩大。<br>待删除第一行<br>待删除第二行<br>待删除第三行<br>AI托管的核心价值保持不变。</div>',
          '<div data-review-deleted-copy><strong>品均拆解：</strong>总确收增长来自覆盖扩大。<br>AI托管的核心价值保持不变，并应继续关注留存质量。</div>',
        )
        .replace(
          '<div data-review-ebita-copy><strong>结论：</strong>EBITA差异均在波动范围<br>内（0.06~0.13pt），AI托管未恶化盈利能力。</div>',
          '<div data-review-ebita-copy><strong>结论：</strong>EBITA差异均在波动范围内（0.06~0.13pt），AI托管未恶化盈利能力，建议继续保留实验策略。</div>',
        )
        .replace(
          '<p data-review-anchor-only style="line-height:48px">稳定开头。<br>稳定中段。<br>只删除这句定位文字。稳定结尾。</p>',
          '<p data-review-anchor-only style="line-height:48px">稳定开头。<br>稳定中段。<br>稳定结尾。</p>',
        )
        .replace(
          "<article id=\"review-tab-one-overview\"><h2>标签一概览</h2><p>第一块完整内容</p></article>\n      <article id=\"review-tab-one-detail\"><h2>标签一详情</h2><p>第二块完整内容</p></article>",
          "<article id=\"review-tab-one-detail\"><h2>标签一详情</h2><p>第二块完整内容</p></article>\n      <article id=\"review-tab-one-overview\"><h2>标签一概览</h2><p>第一块完整内容</p></article>",
        )
        .replace(
          "<article><h2>标签二详情</h2><p>第四块完整内容</p></article>",
          "<article style=\"padding: 24px; border-radius: 16px\"><h2>标签二详情</h2><p>第四块完整内容</p></article>",
        )
        .replace(
          `    <div class="panels" data-review-anonymous-panels>
      <div class="panel" role="tabpanel"><article><p data-review-anonymous-panel-copy="one">匿名面板甲内容</p></article><article><p>匿名面板稳定说明</p></article></div>
      <div class="panel" role="tabpanel"><article><p data-review-anonymous-panel-copy="two">匿名面板乙内容</p></article><article><p>匿名面板稳定说明</p></article></div>
    </div>`,
          `    <div class="panels" data-review-anonymous-panels>
      <div class="panel" role="tabpanel"><article><p data-review-anonymous-panel-copy="two">匿名面板乙内容</p></article><article><p>匿名面板稳定说明</p></article></div>
      <div class="panel" role="tabpanel"><article><p data-review-anonymous-panel-copy="one">匿名面板甲内容</p></article><article><p>匿名面板稳定说明</p></article></div>
    </div>`,
        );
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);

    // The result is reported in the conversation; the process panel is out of the flow.
    const readyDecision = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(readyDecision).toBeVisible({ timeout: 30_000 });
    await expect(readyDecision).toContainText("等待你的决定");
    await expect(runProgress).toHaveCount(0);
    const pending = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(pending.sourcePath).toBe(realpathSync(
      workingHtmlFiles(launched.workspace, request.changeRequest.projectId)[0],
    ));
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    const reviewWorkspace = launched.page.getByTestId("ai-review-workspace");
    await expect(reviewWorkspace).toBeVisible({ timeout: 30_000 });
    const reviewSidebar = reviewWorkspace.getByTestId("ai-conversation-sidebar");
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toHaveCount(1);
    await expect(reviewSidebar).toBeVisible();
    const reviewAiEntry = launched.page.getByRole("button", { name: "AI 助手" });
    await expect(reviewAiEntry).toHaveAttribute("aria-expanded", "true");
    await reviewAiEntry.click();
    await expect(reviewSidebar).toHaveCount(0);
    await expect(launched.page.getByTestId("review-show-conversation")).toHaveCount(0);
    await expect(reviewAiEntry).toHaveCount(1);
    await expect(reviewAiEntry).toHaveAttribute("aria-expanded", "false");
    await reviewAiEntry.click();
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toBeVisible();
    // 审阅工具固定复用工作台顶栏，不再在画布内提供第二套浮动条或收起把手。
    await expect(launched.page.getByRole("button", { name: "收起审阅工具" }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "显示并固定审阅工具" }))
      .toHaveCount(0);
    const sharedHeader = launched.page.locator("header.workbench-header");
    const liveReviewTools = sharedHeader.getByLabel("审阅工具", { exact: true });
    await expect(liveReviewTools).toBeVisible();
    const beforePaneHeader = launched.page.locator(
      'section[data-side="before"] > header',
    );
    await expect.poll(async () => {
      const [sharedHeaderBox, beforePaneHeaderBox] = await Promise.all([
        sharedHeader.boundingBox(),
        beforePaneHeader.boundingBox(),
      ]);
      if (!sharedHeaderBox || !beforePaneHeaderBox) return -1;
      return beforePaneHeaderBox.y - (sharedHeaderBox.y + sharedHeaderBox.height);
    }).toBeGreaterThanOrEqual(0);
    const beforeReviewFrame = launched.page.frameLocator(
      'iframe[title^="修改前"]',
    );
    const afterReviewFrame = launched.page.frameLocator(
      'iframe[title^="修改后"]',
    );
    await assertReviewControlDefaults(launched.page, beforeReviewFrame);
    await expect(beforeReviewFrame.locator("html"))
      .toHaveAttribute("data-author-script-ran", "true");
    await expect(beforeReviewFrame.locator("html"))
      .toHaveAttribute("data-review-fixture-ready", "true");
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-review-fixture-ready", "true");
    await assertReviewHasNoRuntimeVisualSupplement(
      launched.page,
      beforeReviewFrame,
      afterReviewFrame,
    );
    await afterReviewFrame.locator("html").evaluate(() => {
      document.documentElement.dataset.reviewPostLoadNavigationAttempted = "true";
      location.replace(
        "data:text/html,<html data-review-post-load-replacement=true></html>",
      );
    });
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-review-post-load-navigation-attempted", "true");
    await expect(afterReviewFrame.locator("html"))
      .not.toHaveAttribute("data-review-post-load-replacement", "true");
    await expect(afterReviewFrame.locator("html"))
      .not.toHaveAttribute("data-pageroot-preview-navigation-fallback", "true");
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-pageroot-review-filter", "all");
    await expect.poll(async () => afterReviewFrame.locator(
      "[data-review-anonymous-panel-copy]",
    ).evaluateAll((elements) => elements.map((element) => ({
      copy: element.getAttribute("data-review-anonymous-panel-copy"),
      changeId: element.closest("[data-pageroot-review-id]")
        ?.getAttribute("data-pageroot-review-id") || "",
      panelKey: element.closest('[data-pageroot-review-panel-container="true"]')
        ?.getAttribute("data-pageroot-review-panel-key") || "",
    })))).toEqual([
      expect.objectContaining({ copy: "two", changeId: expect.any(String) }),
      expect.objectContaining({ copy: "one", changeId: expect.any(String) }),
    ]);
    const anonymousPanelKeys = await afterReviewFrame.locator(
      "[data-review-anonymous-panel-copy]",
    ).evaluateAll((elements) => elements.map((element) => (
      element.closest('[data-pageroot-review-panel-container="true"]')
        ?.getAttribute("data-pageroot-review-panel-key") || ""
    )));
    expect(new Set(anonymousPanelKeys).size).toBe(2);
    await expect(beforeReviewFrame.locator('meta[http-equiv="refresh"]'))
      .toHaveCount(0);
    const reviewCommentMarkers = launched.page.locator(
      'section[data-side="before"] [data-testid="review-comment-marker"]',
    );
    await expect(reviewCommentMarkers).toHaveCount(2);
    const frozenReviewComment = `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`;
    const reviewCommentMarker = reviewCommentMarkers.filter({
      hasText: frozenReviewComment,
    });
    await expect(reviewCommentMarker).toHaveCount(1);
    await expect(reviewCommentMarkers.filter({
      hasText: ordinaryReviewCommentText,
    })).toHaveCount(1);
    // 只读评论标记与 AI 预览共用同一个组件。它是可聚焦控件而不是静态说明，
    // 因为气泡是读到评论正文的唯一入口，键盘用户必须够得到。
    await expect(reviewCommentMarker).toHaveJSProperty("tagName", "BUTTON");
    await expect(reviewCommentMarker).toHaveAttribute(
      "data-comment-count",
      "1",
    );
    await expect(reviewCommentMarker).toHaveCSS("width", "30px");
    await expect(reviewCommentMarker).toHaveCSS("height", "30px");
    await expect(reviewCommentMarker).toHaveCSS("font-size", "15px");
    await expect(reviewCommentMarker).toHaveCSS("background-color", "rgb(98, 88, 214)");
    await expect(reviewCommentMarker).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(launched.page.locator(
      'section[data-side="after"] [data-testid="review-comment-marker"]',
    )).toHaveCount(0);
    await expect.poll(() => beforeReviewFrame.locator("html").evaluate(
      (element, text) => element.innerHTML.includes(text),
      frozenReviewComment,
    )).toBe(false);
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(
      (element, text) => element.innerHTML.includes(text),
      frozenReviewComment,
    )).toBe(false);
    await reviewCommentMarker.hover();
    const reviewCommentBubble = reviewCommentMarker.getByTestId("review-comment-bubble");
    await expect(reviewCommentBubble).toContainText(frozenReviewComment);
    await expect(reviewCommentBubble).toBeVisible();
    const beforeReviewViewport = launched.page.locator(
      'section[data-side="before"] [aria-label="修改前画布滚动区"]',
    );
    await expect.poll(async () => {
      const [bubbleBox, viewportBox] = await Promise.all([
        reviewCommentBubble.boundingBox(),
        beforeReviewViewport.boundingBox(),
      ]);
      if (!bubbleBox || !viewportBox) return false;
      return bubbleBox.x >= viewportBox.x + 4
        && bubbleBox.x + bubbleBox.width <= viewportBox.x + viewportBox.width - 4;
    }).toBe(true);
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-comment.png"),
        animations: "disabled",
      });
    }
    await launched.page.locator('section[data-side="before"] > header').hover();
    await expect(reviewCommentBubble).toBeHidden();

    // 键盘聚焦打开同一个气泡；焦点离开前不消失。气泡绑的是
    // :focus-visible 而不是 :focus，所以先按一次 Tab 把输入模态切回键盘，
    // 否则前一步 hover 留下的指针模态会让焦点不可见。
    await launched.page.keyboard.press("Tab");
    await reviewCommentMarker.focus();
    await expect(reviewCommentBubble).toBeVisible();
    await expect(reviewCommentBubble).toContainText(frozenReviewComment);
    // 只读标记不响应 Enter/Space，不进入编辑、不打开编辑工具栏。
    await launched.page.keyboard.press("Enter");
    await launched.page.keyboard.press("Space");
    await expect(reviewCommentBubble).toBeVisible();
    await expect(launched.page.locator(
      'section[data-side="before"] [data-testid="review-comment-marker"]',
    )).toHaveCount(2);
    await reviewCommentMarker.blur();
    await expect(reviewCommentBubble).toBeHidden();
    // 接下来继续操作始终固定在工作台顶栏中的审阅控件。
    await expect(liveReviewTools).toBeVisible();
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeHidden();
    await beforeReviewFrame.getByRole("button", { name: "审阅标签二" })
      .evaluate((button) => button.click());
    await expect.poll(async () => beforeReviewFrame.locator("html").evaluate(() => {
      const transitioning = document.documentElement.hasAttribute(
        "data-pageroot-review-transitioning",
      );
      return !transitioning || (
        document.querySelectorAll("[data-pageroot-review-transition-mask]").length === 1
        && document.querySelectorAll("[data-pageroot-review-projection-layer]").length === 0
      );
    })).toBe(true);
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => (
        !document.documentElement.hasAttribute("data-pageroot-review-transitioning")
      ))),
    ).then((states) => states.every(Boolean))).toBe(true);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => {
        const filter = document.documentElement.dataset.pagerootReviewFilter || "all";
        return [...document.querySelectorAll("[data-pageroot-review-overlay-box]")]
          .filter((box) => !String(
            box.getAttribute("data-pageroot-review-fact") || "",
          ).startsWith("style:runtime-projection-"))
          .every((box) => {
            const changeId = box.getAttribute("data-pageroot-review-overlay-box");
            return [...document.querySelectorAll(
              '[data-pageroot-review-marker="' + changeId + '"]',
            )].some((marker) => {
              const markerTypes = String(
                marker.getAttribute("data-pageroot-review-marker-types") || "",
              ).split(/\s+/u);
              const matchesFilter = filter === "all" || markerTypes.includes(filter);
              if (!matchesFilter) return false;
              if (markerTypes.includes("text")) {
                const range = document.createRange();
                range.selectNodeContents(marker);
                const visible = [...range.getClientRects()]
                  .some((rect) => rect.width > 1 && rect.height > 1);
                range.detach();
                return visible;
              }
              return [...marker.getClientRects()]
                .some((rect) => rect.width > 1 && rect.height > 1);
            });
          });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    await beforeReviewFrame.getByRole("button", { name: "审阅标签一" })
      .evaluate((button) => button.click());
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => (
        !document.documentElement.hasAttribute("data-pageroot-review-transitioning")
      ))),
    ).then((states) => states.every(Boolean))).toBe(true);
    await assertReviewHasNoRuntimeVisualSupplement(
      launched.page,
      beforeReviewFrame,
      afterReviewFrame,
    );
    await expect(beforeReviewFrame.locator("#indexed-review-panel-one")).toBeVisible();
    await expect(afterReviewFrame.locator("#indexed-review-panel-one")).toBeVisible();
    await afterReviewFrame.getByRole("button", { name: "抖音搜盘表现" })
      .evaluate((button) => button.click());
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => {
      const documentHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
      );
      const layer = document.documentElement.hasAttribute(
        "data-pageroot-review-transitioning",
      )
        ? document.querySelector("[data-pageroot-review-transition-mask]")
        : document.querySelector("[data-pageroot-review-projection-layer]");
      return Boolean(layer && layer.getBoundingClientRect().height >= documentHeight - 1);
    })).toBe(true);
    await expect(afterReviewFrame.locator("#indexed-review-panel-two")).toBeVisible();
    await expect(beforeReviewFrame.locator("#indexed-review-panel-two")).toBeVisible();
    await expect(afterReviewFrame.locator("#indexed-review-panel-one")).toBeHidden();
    await expect(beforeReviewFrame.locator("#indexed-review-panel-one")).toBeHidden();
    const beforeCounter = beforeReviewFrame.locator("[data-review-counter]");
    const afterCounter = afterReviewFrame.locator("[data-review-counter]");
    await beforeCounter.evaluate((button) => button.click());
    await expect(beforeCounter).toHaveAttribute("data-count", "1");
    await expect(afterCounter).toHaveAttribute("data-count", "1");
    await beforeReviewFrame.getByRole("textbox", { name: "审阅同步输入" })
      .fill("双页动作同步");
    await expect(afterReviewFrame.getByRole("textbox", { name: "审阅同步输入" }))
      .toHaveValue("双页动作同步");
    await launched.page.getByRole("button", { name: "独立滚动" }).click();
    await afterCounter.evaluate((button) => button.click());
    await expect(beforeCounter).toHaveAttribute("data-count", "2");
    await expect(afterCounter).toHaveAttribute("data-count", "2");
    await afterReviewFrame.getByRole("textbox", { name: "审阅同步输入" })
      .fill("反向动作同步");
    await expect(beforeReviewFrame.getByRole("textbox", { name: "审阅同步输入" }))
      .toHaveValue("反向动作同步");
    await launched.page.getByRole("button", { name: "同步滚动" }).click();
    await assertReviewChangeOutline(beforeReviewFrame, afterReviewFrame);
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"], [data-pageroot-review-overlay-box][data-tone="structure"], [data-pageroot-review-overlay-box][data-tone="style"], [data-pageroot-review-overlay-box][data-tone="mixed"]',
    ).count()).toBeGreaterThan(0);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        "[data-pageroot-review-overlay-box]",
      ).evaluateAll((boxes) => {
        if (!boxes.length) return false;
        const textGroups = new Map();
        const standaloneBoxes = [];
        boxes.forEach((box) => {
          const textBox = (box.getAttribute("data-types") || "")
            .split(/\s+/).includes("text");
          const key = textBox
            ? [
              box.getAttribute("data-pageroot-review-overlay-box"),
              box.getAttribute("data-tone"),
              box.getAttribute("data-pageroot-review-semantic-owner"),
              box.getAttribute("data-pageroot-review-geometry-owner"),
              box.getAttribute("data-text-operation"),
            ].join("|")
            : "";
          if (!key) {
            standaloneBoxes.push(box);
            return;
          }
          const grouped = textGroups.get(key) || [];
          grouped.push(box);
          textGroups.set(key, grouped);
        });
        const validLabel = (label) => {
          const text = label?.textContent?.trim() || "";
          // A region caption may compose several kinds ("新增内容 · 视觉调整"),
          // read "{caption} ×N" for a genuine cluster, or spell per-kind fact
          // counts on the focused change, so the sane range is wider than one
          // bare summary.
          return text.length >= 2 && text.length <= 40;
        };
        // One change region carries at most one caption: the region caption
        // sits on the change's topmost box and an aggregated neighbour carries
        // none. The invariant that guards real bugs is "never more than one
        // label per box, and never more than one per text group".
        const hasAnyLabel = boxes.some((box) => (
          box.querySelector("[data-pageroot-review-overlay-label]")
        ));
        return hasAnyLabel && standaloneBoxes.every((box) => {
          const labels = box.querySelectorAll("[data-pageroot-review-overlay-label]");
          return labels.length <= 1 && (labels.length === 0 || validLabel(labels[0]));
        }) && [...textGroups.values()].every((group) => {
          const labels = group.flatMap((box) => (
            [...box.querySelectorAll("[data-pageroot-review-overlay-label]")]
          ));
          return labels.length <= 1 && (labels.length === 0 || validLabel(labels[0]));
        });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    const nestedOverlayPairs = await afterReviewFrame.locator(
      "[data-pageroot-review-overlay-box]",
    ).evaluateAll((boxes) => boxes.flatMap((outer, outerIndex) => {
      const outerRect = outer.getBoundingClientRect();
      return boxes.flatMap((inner, innerIndex) => {
        if (outerIndex === innerIndex) return [];
        const innerRect = inner.getBoundingClientRect();
        const sameOwner = outer.getAttribute("data-pageroot-review-semantic-owner")
          === inner.getAttribute("data-pageroot-review-semantic-owner");
        const sameFact = outer.getAttribute("data-pageroot-review-fact")
          === inner.getAttribute("data-pageroot-review-fact");
        const nested = outer.getAttribute("data-pageroot-review-overlay-box")
          === inner.getAttribute("data-pageroot-review-overlay-box")
          && sameOwner
          && sameFact
          && innerRect.width * innerRect.height < outerRect.width * outerRect.height * .86
          && innerRect.left >= outerRect.left - 2
          && innerRect.top >= outerRect.top - 2
          && innerRect.right <= outerRect.right + 2
          && innerRect.bottom <= outerRect.bottom + 2;
        return nested ? [{
          changeId: outer.getAttribute("data-pageroot-review-overlay-box"),
          outer: {
            summary: outer.textContent,
            tone: outer.getAttribute("data-tone"),
            rect: [outerRect.x, outerRect.y, outerRect.width, outerRect.height],
          },
          inner: {
            summary: inner.textContent,
            tone: inner.getAttribute("data-tone"),
            rect: [innerRect.x, innerRect.y, innerRect.width, innerRect.height],
          },
        }] : [];
      });
    }));
    expect(nestedOverlayPairs).toEqual([]);
    const addedRowSemanticOwner = await assertProjectionGeometryCase(
      afterReviewFrame,
      REVIEW_PROJECTION_CASES[0],
    );
    const removedAtomicOwner = await beforeReviewFrame.locator(
      "[data-review-atomic-removed]",
    ).getAttribute("data-pageroot-review-semantic-owner");
    const addedAtomicOwner = await afterReviewFrame.locator(
      "[data-review-atomic-added]",
    ).getAttribute("data-pageroot-review-semantic-owner");
    expect(removedAtomicOwner).toBeTruthy();
    expect(addedAtomicOwner).toBeTruthy();
    await expect(beforeReviewFrame.locator(
      '[data-review-atomic-removed][data-pageroot-review-structure="removed"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-atomic-added][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    for (const [frame, owner] of [
      [beforeReviewFrame, removedAtomicOwner],
      [afterReviewFrame, addedAtomicOwner],
    ]) {
      await expect(frame.locator(
        `[data-pageroot-review-overlay-box][data-tone="structure"][data-pageroot-review-semantic-owner="${owner}"]`,
      )).toHaveCount(1);
      await expect(frame.locator(
        `[data-pageroot-review-mask-hole][data-pageroot-review-semantic-owner="${owner}"]`,
      )).toHaveCount(1);
    }
    await expect(beforeReviewFrame.locator(
      '[data-review-atomic-stable-before] [data-pageroot-review-text], [data-review-atomic-stable-after] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-atomic-stable-before] [data-pageroot-review-text], [data-review-atomic-stable-after] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect.poll(async () => beforeReviewFrame.locator(
      "[data-pageroot-review-id]",
    ).first().evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-all-changes.png"),
        animations: "disabled",
      });
    }
    await launched.page.getByRole("button", { name: "文字变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("text");
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).not.toBe("all");
    // Switching the filter must land on the first matching change instead of
    // leaving the navigator on an unmatched target with an empty viewport.
    const changeNavigator = launched.page.getByRole("button", { name: "下一处变化" })
      .locator("xpath=..");
    await expect(changeNavigator.locator("strong")).toHaveText("1");
    // The unified toolbar owns the filtered region total.
    const filteredRegionTotal = (await changeNavigator.locator("span").textContent())
      ?.split("/")[1] || "";
    expect(Number(filteredRegionTotal)).toBeGreaterThan(0);
    const filteredFocusChangeId = await beforeReviewFrame.locator("html")
      .getAttribute("data-pageroot-review-focus");
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${filteredFocusChangeId}"]`,
    )).not.toHaveCount(0);
    // A target that still matches the new filter keeps the user's position.
    await launched.page.getByRole("button", { name: "下一处变化" }).click();
    await expect(changeNavigator.locator("strong")).toHaveText("2");
    await launched.page.getByRole("button", { name: "文字变化" }).click();
    await expect(changeNavigator.locator("strong")).toHaveText("2");
    await launched.page.getByRole("button", { name: "上一处变化" }).click();
    await expect(changeNavigator.locator("strong")).toHaveText("1");
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-text="removed"]',
    ).filter({ hasText: ORIGINAL_TEXT })).toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-text="added"]',
    ).filter({ hasText: UPDATED_TEXT })).toBeVisible();
    const deletedPriority = beforeReviewFrame.locator(
      '[data-review-priority][data-pageroot-review-structure="removed"]',
    );
    await expect(deletedPriority).toHaveCount(1);
    await expect(deletedPriority.locator("[data-pageroot-review-text]")).toHaveCount(0);
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-text-mark="removed"]',
    ).count()).toBeGreaterThan(0);
    const addedText = afterReviewFrame.locator(
      '[data-pageroot-review-text="added"]',
    ).filter({ hasText: UPDATED_TEXT });
    await expect.poll(() => addedText.evaluate(
      (element) => getComputedStyle(element).textDecorationLine,
    )).toBe("none");
    await expect.poll(() => addedText.evaluate(
      (element) => getComputedStyle(element).textEmphasisStyle,
    )).toBe("none");
    expect(await addedText.evaluate((element) => getComputedStyle(element).color))
      .toBe(await addedText.evaluate((element) => getComputedStyle(element.parentElement).color));
    expect(await addedText.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe(await addedText.evaluate((element) => getComputedStyle(element.parentElement).fontSize));
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-text-mark="added"]',
    ).count()).toBeGreaterThan(0);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        "[data-review-injection-stability]",
      ).evaluate((target) => {
        const marker = target.querySelector("[data-pageroot-review-text]");
        const left = target.querySelector("[data-review-stable-left]");
        const right = target.querySelector("[data-review-stable-right]");
        if (!marker || !left || !right) return false;
        const range = document.createRange();
        range.selectNodeContents(marker);
        const rangeRects = [...range.getClientRects()]
          .filter((rect) => rect.width > 1 && rect.height > 1).length;
        range.detach();
        const snapshot = () => [left, right].map((element) => {
          const rect = element.getBoundingClientRect();
          return [rect.left, rect.top, rect.right, rect.bottom];
        });
        const wrapped = snapshot();
        const placeholder = document.createComment("review-marker-position");
        const text = document.createTextNode(marker.textContent || "");
        marker.before(placeholder);
        marker.replaceWith(text);
        const unwrapped = snapshot();
        text.replaceWith(marker);
        placeholder.remove();
        const maximumDelta = Math.max(...wrapped.flatMap((rect, index) => (
          rect.map((value, coordinate) => Math.abs(value - unwrapped[index][coordinate]))
        )));
        return rangeRects > 0
          && marker.getClientRects().length === 0
          && getComputedStyle(marker).display === "contents"
          && maximumDelta < .25;
      })),
    ).then((results) => results.every(Boolean))).toBe(true);
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"]',
    ).count()).toBeGreaterThan(0);
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-removed"]',
    ).count()).toBeGreaterThan(0);
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"]',
    ).first().evaluate((element) => {
      const shape = element.querySelector("[data-pageroot-review-overlay-shape]");
      return shape ? getComputedStyle(shape).stroke : getComputedStyle(element).borderTopColor;
    }))
      .toBe("rgb(109, 92, 231)");
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-removed"]',
    ).first().evaluate((element) => {
      const shape = element.querySelector("[data-pageroot-review-overlay-shape]");
      return shape ? getComputedStyle(shape).stroke : getComputedStyle(element).borderTopColor;
    }))
      .toBe("rgb(109, 92, 231)");
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-removed"][data-shaped="true"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"][data-shaped="true"]',
    )).toHaveCount(0);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => {
        const tolerance = .75;
        const contains = (outer, inner) => (
          outer.left <= inner.left + tolerance
          && outer.top <= inner.top + tolerance
          && outer.right >= inner.right - tolerance
          && outer.bottom >= inner.bottom - tolerance
        );
        return [...document.querySelectorAll("[data-pageroot-review-text]")].every((marker) => {
          const groupId = marker.getAttribute("data-pageroot-review-text-group") || "";
          const tone = marker.getAttribute("data-pageroot-review-text") === "removed"
            ? "text-removed"
            : "text-added";
          const frames = [...document.querySelectorAll(
            '[data-pageroot-review-overlay-box][data-tone="' + tone + '"]',
          )].filter((box) => (
            (box.getAttribute("data-text-groups") || box.getAttribute("data-text-group") || "")
              .split(/\s+/).includes(groupId)
          ));
          const range = document.createRange();
          range.selectNodeContents(marker);
          const evidenceRects = [...range.getClientRects()]
            .filter((rect) => rect.width > 1 && rect.height > 1)
            .map((rect) => ({
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            }));
          range.detach();
          if (!evidenceRects.length) return true;
          return frames.length > 0 && evidenceRects.every((evidence) => (
            frames.some((box) => contains(box.getBoundingClientRect(), evidence))
          ));
        });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => {
        const tolerance = 2;
        const contains = (outer, inner) => (
          outer.left <= inner.left + tolerance
          && outer.top <= inner.top + tolerance
          && outer.right >= inner.right - tolerance
          && outer.bottom >= inner.bottom - tolerance
        );
        return [...document.querySelectorAll("[data-pageroot-review-text-mark]")].every((mark) => {
          const tone = mark.getAttribute("data-pageroot-review-text-mark") === "removed"
            ? "text-removed"
            : "text-added";
          const boxes = [...document.querySelectorAll(
            '[data-pageroot-review-overlay-box][data-tone="' + tone + '"]',
          )];
          const rect = mark.getBoundingClientRect();
          return boxes.some((box) => contains(box.getBoundingClientRect(), rect));
        });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        '[data-pageroot-review-overlay-box][data-scope="text-phrase"]',
      ).evaluateAll((boxes) => boxes.every((box) => (
        box.getBoundingClientRect().width >= 24
      )))),
    ).then((states) => states.every(Boolean))).toBe(true);
    const beforeRewriteMarker = beforeReviewFrame.locator(
      '[data-review-readable-rewrite] [data-pageroot-review-text="removed"]',
    ).first();
    const afterRewriteMarker = afterReviewFrame.locator(
      '[data-review-readable-rewrite] [data-pageroot-review-text="added"]',
    ).first();
    await expect(beforeRewriteMarker).toHaveAttribute(
      "data-pageroot-review-summary",
      "文本调整",
    );
    await expect(afterRewriteMarker).toHaveAttribute(
      "data-pageroot-review-summary",
      "文本调整",
    );
    const beforeRewriteGroup = await beforeRewriteMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    const afterRewriteGroup = await afterRewriteMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(beforeRewriteGroup).toBeTruthy();
    expect(afterRewriteGroup).toBeTruthy();
    const beforeRewriteFrame = beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-removed"][data-text-group="${beforeRewriteGroup}"]`,
    );
    const afterRewriteFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${afterRewriteGroup}"]`,
    );
    await expect(beforeRewriteFrame).toHaveCount(1);
    await expect(afterRewriteFrame).toHaveCount(1);
    await expect(beforeRewriteFrame).toHaveAttribute("data-scope", "text-block");
    await expect(afterRewriteFrame).toHaveAttribute("data-scope", "text-block");
    await expect(beforeRewriteFrame).toHaveAttribute(
      "data-pageroot-review-fragment-count",
      "1",
    );
    await expect(afterRewriteFrame).toHaveAttribute(
      "data-pageroot-review-fragment-count",
      "1",
    );
    // The rewrite vocabulary is anchored on the per-record summary; the
    // caption composes the kinds of its spatial stretch and may aggregate
    // with same-caption neighbours, so caption presence and form are covered
    // by the review-annotation-clarity contract instead of per-scenario text.
    await expect(beforeRewriteFrame).toHaveAttribute("data-summary", "段落改写");
    await expect(afterRewriteFrame).toHaveAttribute("data-summary", "段落改写");
    // The quiet-by-default contract: a text box rests transparent and turns
    // solid violet only while its change is focused.
    for (const rewriteFrame of [beforeRewriteFrame, afterRewriteFrame]) {
      await expect.poll(() => rewriteFrame.evaluate((element) => {
        const style = getComputedStyle(element);
        const claimed = element.dataset.active === "true";
        return {
          style: style.borderTopStyle,
          claimMatchesFocus: claimed
            ? style.borderTopColor === "rgb(109, 92, 231)"
            : style.borderTopColor === "rgba(0, 0, 0, 0)",
        };
      })).toEqual({ style: "solid", claimMatchesFocus: true });
    }
    for (const [frame, tone, evidenceCharacter] of [
      [beforeReviewFrame, "removed", "旧"],
      [afterReviewFrame, "added", "新"],
    ]) {
      const lineOwner = frame.locator("[data-review-line-scope]");
      const lineMarkers = lineOwner.locator(
        `[data-pageroot-review-text="${tone}"]`,
      );
      await expect(lineMarkers).toHaveCount(2);
      expect(await lineMarkers.allTextContents()).toEqual([
        evidenceCharacter,
        evidenceCharacter,
      ]);
      const semanticOwnerId = await lineMarkers.first().getAttribute(
        "data-pageroot-review-semantic-owner",
      );
      expect(semanticOwnerId).toBeTruthy();
      const lineGroups = await lineMarkers.evaluateAll((markers) => (
        [...new Set(markers.map((marker) => (
          marker.getAttribute("data-pageroot-review-text-group") || ""
        )).filter(Boolean))]
      ));
      expect(lineGroups).toHaveLength(2);
      const lineFrame = frame.locator(
        `[data-pageroot-review-overlay-box][data-tone="text-${tone}"]`
          + `[data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      );
      const lineHole = frame.locator(
        `[data-pageroot-review-mask-hole]`
          + `[data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      );
      await expect(lineFrame).toHaveCount(1);
      await expect(lineHole).toHaveCount(1);
      await expect(lineFrame).toHaveAttribute("data-scope", "text-line");
      await expect(lineFrame).not.toHaveAttribute("data-shaped", "true");
      await expect(lineFrame).toHaveAttribute(
        "data-pageroot-review-fragment-count",
        "1",
      );
      await expect(lineFrame).toHaveAttribute("data-summary", "文本调整");
      expect((await lineFrame.getAttribute("data-text-groups") || "")
        .split(/\s+/).filter(Boolean)).toEqual(lineGroups);
      await expect.poll(async () => {
        const frameGeometry = await lineFrame.evaluate((element) => ({
          left: Number(element.getAttribute("data-left")),
          top: Number(element.getAttribute("data-top")),
          width: Number(element.getAttribute("data-width")),
          height: Number(element.getAttribute("data-height")),
        }));
        const holeGeometry = await lineHole.evaluate((element) => ({
          left: Number(element.getAttribute("data-left")),
          top: Number(element.getAttribute("data-top")),
          width: Number(element.getAttribute("data-width")),
          height: Number(element.getAttribute("data-height")),
        }));
        return Object.keys(frameGeometry).every((key) => (
          Math.abs(frameGeometry[key] - holeGeometry[key]) < .01
        ));
      }).toBe(true);
    }
    for (const [frame, tone, evidenceCharacter] of [
      [beforeReviewFrame, "removed", "旧"],
      [afterReviewFrame, "added", "新"],
    ]) {
      const promotionOwner = frame.locator("[data-review-scope-promotion]");
      const promotionMarkers = promotionOwner.locator(
        `[data-pageroot-review-text="${tone}"]`,
      );
      await expect(promotionMarkers).toHaveCount(9);
      expect(await promotionMarkers.allTextContents()).toEqual(
        Array.from({ length: 9 }, () => evidenceCharacter),
      );
      await expect(promotionOwner.locator(
        `[data-pageroot-review-text="${tone}"]`,
      ).filter({ hasText: "稳定开场" })).toHaveCount(0);
      const semanticOwnerId = await promotionMarkers.first().getAttribute(
        "data-pageroot-review-semantic-owner",
      );
      expect(semanticOwnerId).toBeTruthy();
      const promotionGroups = await promotionMarkers.evaluateAll((markers) => (
        [...new Set(markers.map((marker) => (
          marker.getAttribute("data-pageroot-review-text-group") || ""
        )).filter(Boolean))]
      ));
      expect(promotionGroups).toHaveLength(9);
      const promotionFrame = frame.locator(
        `[data-pageroot-review-overlay-box][data-tone="text-${tone}"]`
          + `[data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      );
      const promotionHole = frame.locator(
        `[data-pageroot-review-mask-hole]`
          + `[data-pageroot-review-semantic-owner="${semanticOwnerId}"]`,
      );
      await expect(promotionFrame).toHaveCount(1);
      await expect(promotionHole).toHaveCount(1);
      await expect(promotionFrame).toHaveAttribute("data-scope", "text-block");
      await expect(promotionFrame).not.toHaveAttribute("data-shaped", "true");
      await expect(promotionFrame).toHaveAttribute(
        "data-pageroot-review-fragment-count",
        "1",
      );
      await expect(promotionFrame).toHaveAttribute("data-summary", "段落改写");
      expect((await promotionFrame.getAttribute("data-text-groups") || "")
        .split(/\s+/).filter(Boolean)).toEqual(promotionGroups);
      await expect.poll(async () => {
        const frameBox = await promotionFrame.boundingBox();
        const ownerBox = await promotionOwner.boundingBox();
        const frameGeometry = await promotionFrame.evaluate((element) => ({
          left: Number(element.getAttribute("data-left")),
          top: Number(element.getAttribute("data-top")),
          width: Number(element.getAttribute("data-width")),
          height: Number(element.getAttribute("data-height")),
        }));
        const holeGeometry = await promotionHole.evaluate((element) => ({
          left: Number(element.getAttribute("data-left")),
          top: Number(element.getAttribute("data-top")),
          width: Number(element.getAttribute("data-width")),
          height: Number(element.getAttribute("data-height")),
        }));
        return Boolean(
          frameBox
          && ownerBox
          && frameBox.x >= ownerBox.x - 4
          && frameBox.x + frameBox.width <= ownerBox.x + ownerBox.width + 4
          && frameBox.height >= ownerBox.height * .75
          && Object.keys(frameGeometry).every((key) => (
            Math.abs(frameGeometry[key] - holeGeometry[key]) < .01
          )),
        );
      }).toBe(true);
    }
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      for (const frame of [beforeReviewFrame, afterReviewFrame]) {
        await frame.locator("[data-review-scope-promotion]").evaluate((element) => {
          element.scrollIntoView({ block: "center", inline: "nearest" });
        });
      }
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-scope-promotion.png"),
        animations: "disabled",
      });
    }
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      "[data-review-reference]",
    )).toHaveAttribute(
      "data-pageroot-review-text-anchors",
      /text-\d+-\d+@\d+/u,
    );
    await expect(afterReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "本实验" })).toHaveAttribute(
      "data-pageroot-review-summary",
      "新增内容",
    );
    await expect(afterReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text="added"]',
    )).toHaveAttribute("data-pageroot-review-text-operation", "insert");
    await expect(beforeReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text="removed"]',
    )).toHaveText("换言之，");
    await expect(beforeReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text="removed"]',
    )).toHaveAttribute("data-pageroot-review-summary", "删除内容");
    await expect(afterReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text-context="added"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      "[data-review-delete-only]",
    )).toHaveAttribute(
      "data-pageroot-review-text-anchors",
      /text-\d+-\d+@\d+/u,
    );
    await expect(beforeReviewFrame.locator(
      '[data-review-anchor-only] [data-pageroot-review-text="removed"]',
    )).toHaveText("只删除这句定位文字。");
    await expect(afterReviewFrame.locator(
      '[data-review-anchor-only] [data-pageroot-review-text]',
    )).toHaveCount(0);
    const anchorOnlyChangeId = await afterReviewFrame.locator(
      "[data-review-anchor-only-section]",
    ).getAttribute("data-pageroot-review-id");
    expect(anchorOnlyChangeId).toBeTruthy();
    await expect(afterReviewFrame.locator(
      "[data-review-anchor-only]",
    )).toHaveAttribute("data-pageroot-review-anchor-change", anchorOnlyChangeId);
    const anchorOffsets = await afterReviewFrame.locator(
      "[data-review-anchor-only]",
    ).evaluate((anchor) => String(
      anchor.getAttribute("data-pageroot-review-text-anchors") || "",
    ).split(/\s+/).filter(Boolean).map((encoded) => (
      Number(encoded.slice(encoded.lastIndexOf("@") + 1))
    )));
    expect(anchorOffsets).toContain("稳定开头。稳定中段。".length);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    )).toHaveText("④ 后续重点：继续观察新增商品。");
    await expect(afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    )).toHaveCount(1);
    const numberedLineMarker = afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    );
    const numberedLineGroup = await numberedLineMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(numberedLineGroup).toBeTruthy();
    const numberedLineFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${numberedLineGroup}"]`,
    );
    await expect(numberedLineFrame).toHaveCount(1);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(1);
    await expect.poll(() => numberedLineFrame.locator(
      "[data-pageroot-review-overlay-label]",
    ).count()).toBeLessThanOrEqual(1);
    await expect(numberedLineFrame).toHaveAttribute("data-summary", "新增内容");
    await expect(numberedLineFrame).not.toHaveAttribute("data-scope", "text-block");
    await expect.poll(async () => {
      const frameBox = await numberedLineFrame.boundingBox();
      const ownerBox = await afterReviewFrame.locator(
        "[data-review-numbered-lines]",
      ).boundingBox();
      return Boolean(frameBox && ownerBox && frameBox.height < ownerBox.height * 0.55);
    }).toBe(true);
    await expect(beforeReviewFrame.locator(
      '[data-review-list-items] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-added-list-item][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-list-items] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-nested-list] [data-pageroot-review-text], [data-review-nested-list][data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-nested-list] [data-pageroot-review-text], [data-review-nested-list][data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-brand-table] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-brand-row="added"] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-brand-row="added"][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-brand-row]:not([data-review-brand-row="added"]) [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-layout-only] [data-pageroot-review-text], [data-review-layout-only] [data-pageroot-review-text-context]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-layout-only] [data-pageroot-review-text], [data-review-layout-only] [data-pageroot-review-text-context]',
    )).toHaveCount(0);
    const crossLineMarker = afterReviewFrame.locator(
      '[data-review-cross-line] [data-pageroot-review-text="added"]',
    );
    await expect(crossLineMarker).toHaveAttribute(
      "data-pageroot-review-text-operation",
      "insert",
    );
    const crossLineGroup = await crossLineMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(crossLineGroup).toBeTruthy();
    const crossLineRectCount = await crossLineMarker.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const count = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1).length;
      range.detach();
      return count;
    });
    expect(crossLineRectCount).toBeGreaterThan(1);
    const crossLineFrames = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${crossLineGroup}"]`,
    );
    // Every rendered line of this owner is touched, so the wrapped insertion
    // reads as one clean paragraph rectangle instead of a ladder of per-line
    // boxes. A partly touched owner still keeps one rectangle per line — see the
    // stable-sentence rewrite below, whose untouched closing line forbids the
    // paragraph rectangle.
    await expect(crossLineFrames).toHaveCount(1);
    await expect(crossLineFrames).toHaveAttribute("data-scope", "text-block");
    await expect.poll(() => crossLineFrames.evaluateAll((frames) => frames.every((frame) => (
      ["text-phrase", "text-line", "text-block"].includes(
        frame.getAttribute("data-scope") || "",
      )
      && frame.getAttribute("data-shaped") !== "true"
      && frame.getAttribute("data-pageroot-review-fragment-count") === "1"
    )))).toBe(true);
    // Collapsing several line rectangles into one is only safe while the single
    // rectangle still contains every character of the wrapped marker.
    await expect.poll(() => crossLineMarker.evaluate((element, selector) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1);
      range.detach();
      const boxes = [...document.querySelectorAll(selector)]
        .map((box) => box.getBoundingClientRect());
      return rects.length > 1 && rects.every((rect) => boxes.some((box) => (
        rect.left >= box.left - 1
        && rect.top >= box.top - 1
        && rect.right <= box.right + 1
        && rect.bottom <= box.bottom + 1
      )));
    }, `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${crossLineGroup}"]`))
      .toBe(true);
    await expect.poll(() => crossLineFrames.locator(
      "[data-pageroot-review-overlay-label]",
    ).count()).toBeLessThanOrEqual(1);
    for (const [frame, tone] of [
      [beforeReviewFrame, "removed"],
      [afterReviewFrame, "added"],
    ]) {
      await expect.poll(() => frame.locator("html").evaluate((_documentElement, expectedTone) => {
        const owner = document.querySelector("[data-review-stable-sentence-rewrite]");
        if (!owner) return { matches: false, reason: "owner-missing" };
        const markers = [...owner.querySelectorAll(
          '[data-pageroot-review-text="' + expectedTone + '"]',
        )];
        if (!markers.length) return { matches: false, reason: "marker-missing" };
        const semanticOwnerId = markers[0].getAttribute(
          "data-pageroot-review-semantic-owner",
        ) || "";
        const markerRects = markers.flatMap((candidate) => {
          const markerRange = document.createRange();
          markerRange.selectNodeContents(candidate);
          const rects = [...markerRange.getClientRects()]
            .filter((rect) => rect.width > 1 && rect.height > 1)
            .map((rect) => ({
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            }));
          markerRange.detach();
          return rects;
        });
        const frames = [...document.querySelectorAll(
          '[data-pageroot-review-overlay-box][data-tone="text-' + expectedTone + '"]'
            + '[data-pageroot-review-semantic-owner="' + semanticOwnerId + '"]',
        )];
        const holes = [...document.querySelectorAll(
          '[data-pageroot-review-mask-hole]'
            + '[data-pageroot-review-semantic-owner="' + semanticOwnerId + '"]',
        )];
        const overlaps = (left, right) => (
          Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
          && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
        );
        const matches = markerRects.length >= 3
            && frames.length >= 1
            && holes.length === frames.length
            && markerRects.every((rect) => frames.some((frame) => (
              overlaps(rect, frame.getBoundingClientRect())
            )))
            && frames.every((frame) => markerRects.some((rect) => (
              overlaps(frame.getBoundingClientRect(), rect)
            )))
            && frames.every((frame) => (
              frame.getAttribute("data-scope") !== "text-block"
              && frame.getAttribute("data-shaped") !== "true"
              && frame.getAttribute("data-pageroot-review-fragment-count") === "1"
            ))
            && frames.filter((frame) => (
              frame.querySelector("[data-pageroot-review-overlay-label]")
            )).length <= 1
            && ![...owner.querySelectorAll("[data-pageroot-review-text]")].some((candidate) => (
              /稳定(?:前|后)句/u.test(candidate.textContent || "")
            ));
        return {
          matches,
          markerRectCount: markerRects.length,
          markerCount: markers.length,
          frameCount: frames.length,
          holeCount: holes.length,
          scopes: frames.map((candidate) => candidate.getAttribute("data-scope")),
        };
      }, tone)).toMatchObject({ matches: true });
    }
    const warningRemovedText = await beforeReviewFrame.locator(
      '[data-review-warning] [data-pageroot-review-text="removed"]',
    ).allTextContents();
    expect(warningRemovedText.join(""))
      .not.toContain("7/28)增幅收窄至负值区间，需");
    await expect(beforeReviewFrame.locator(
      '[data-review-semantic-copy] [data-pageroot-review-text="removed"]',
    )).toHaveText("品均基本持平");
    await expect(afterReviewFrame.locator(
      '[data-review-semantic-copy] [data-pageroot-review-text="added"]',
    )).toHaveText("单品效率整体稳定，增幅仅+0.10%");
    await expect(beforeReviewFrame.locator(
      '[data-review-deleted-copy] [data-pageroot-review-text="removed"]',
    ).filter({ hasText: /^待删除第/u })).toHaveCount(3);
    await expect(beforeReviewFrame.locator(
      '[data-review-break-layout] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-break-layout] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "vs" })).toHaveCount(1);
    await expect(beforeReviewFrame.locator(
      '[data-review-ebita-copy] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-ebita-copy] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "建议继续保留实验策略" })).toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-review-regression-summary] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-text]',
    )).toHaveCount(0);
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-text-changes.png"),
        animations: "disabled",
      });
    }
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-text]',
    ).filter({ hasText: "第二块完整内容" })).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-text]',
    ).filter({ hasText: "第二块完整内容" })).toHaveCount(0);
    const textMask = afterReviewFrame.locator(
      '[data-pageroot-review-mask-dim]',
    );
    await expect(textMask).toBeAttached();
    await expect.poll(() => textMask.getAttribute("fill-opacity"))
      .toBe("0.82");
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-mask-layer]',
    ).evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      borderWidth: getComputedStyle(element).borderTopWidth,
    }))).toEqual({ background: "rgba(0, 0, 0, 0)", borderWidth: "0px" });
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-projection-layer], [data-pageroot-review-mask-layer], [data-pageroot-review-overlay-box], [data-pageroot-review-overlay-shape-svg]',
    ).evaluateAll((elements) => elements.length > 0 && elements.every((element) => (
      getComputedStyle(element).outlineStyle === "none"
    )))).toBe(true);
    await expect.poll(async () => {
      const boxes = await afterReviewFrame.locator(
        '[data-pageroot-review-overlay-box]',
      ).evaluateAll((elements) => elements.map((element) => ({
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
        path: element.getAttribute("data-path"),
      })));
      const holes = await afterReviewFrame.locator(
        '[data-pageroot-review-mask-hole]',
      ).evaluateAll((elements) => elements.map((element) => ({
        left: Number(element.getAttribute("data-left")),
        top: Number(element.getAttribute("data-top")),
        width: Number(element.getAttribute("data-width")),
        height: Number(element.getAttribute("data-height")),
        path: element.getAttribute("d"),
      })));
      return boxes.length === holes.length && boxes.every((box, index) => (
        Math.abs(box.left - holes[index].left) < 0.02
        && Math.abs(box.top - holes[index].top) < 0.02
        && Math.abs(box.width - holes[index].width) < 0.02
        && Math.abs(box.height - holes[index].height) < 0.02
        && Boolean(holes[index].path)
        && box.path === holes[index].path
      ));
    }).toBe(true);
    await launched.page.getByRole("button", { name: "全部变化" }).click();
    await expect.poll(async () => afterReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("all");
    await launched.page.getByRole("button", { name: "文字变化" }).click();
    await expect.poll(async () => afterReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("text");
    // The content map is removed, so its outline, group counts and drawer geometry have
    // nothing left to assert. What still matters is the focus behaviour below, and a
    // change is reached by stepping the change navigator instead of picking it off a map.
    await focusChangeById(launched.page, afterReviewFrame, anchorOnlyChangeId);
    await expect.poll(async () => afterReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).toBe(anchorOnlyChangeId);
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => {
      const anchor = document.querySelector("[data-review-anchor-only]");
      if (!anchor) return false;
      const targetNode = [...anchor.childNodes].find((node) => (
        node.nodeType === Node.TEXT_NODE
        && node.textContent?.includes("稳定结尾。")
      ));
      if (!targetNode) return false;
      const range = document.createRange();
      range.selectNodeContents(targetNode);
      const targetTop = range.getBoundingClientRect().top;
      range.detach();
      // The anchor is near the end of this long fixture. When the desired
      // reference line is past the document's maximum scroll, the browser
      // correctly clamps at the bottom and the target remains below it.
      const referenceTop = Math.max(18, innerHeight * .12);
      const documentTop = targetTop + scrollY;
      const maximumScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const desiredScroll = Math.max(
        0,
        Math.min(maximumScroll, documentTop - referenceTop),
      );
      const expectedTop = documentTop - desiredScroll;
      return Math.abs(targetTop - expectedTop) <= 28;
    })).toBe(true);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    const ebitaChangeId = await beforeReviewFrame.locator(
      "[data-review-ebita-section]",
    ).getAttribute("data-pageroot-review-id");
    expect(ebitaChangeId).toBeTruthy();
    await focusChangeById(launched.page, beforeReviewFrame, ebitaChangeId);
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).toBe(ebitaChangeId);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${ebitaChangeId}"]`,
    )).toHaveCount(0);
    await expect.poll(() => afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${ebitaChangeId}"]`,
    ).count()).toBeGreaterThan(0);
    await beforeCounter.evaluate((button) => button.click());
    await expect(afterCounter).toHaveAttribute("data-count", "3");
    // The outline item that used to select this change lived in the content map.
    await launched.page.getByRole("button", { name: "下一处变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("text");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(launched.page.getByRole("slider", {
      name: "非修改区域上下文可见度",
    })).toHaveValue("18");
    await launched.page.getByRole("button", { name: "全部变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("all");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "元素变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("structure");
    await expect(beforeReviewFrame.locator("[data-pageroot-review-structure]").first())
      .toBeVisible();
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).first()).toBeAttached();
    // The old structure blue folded into the single violet accent family: a
    // structure box either rests transparent or claims violet while focused.
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).first().evaluate((element) => {
      const shape = element.querySelector("[data-pageroot-review-overlay-shape]");
      return shape ? getComputedStyle(shape).stroke : getComputedStyle(element).borderTopColor;
    }))
      .toMatch(/^(?:rgba\(0, 0, 0, 0\)|rgb\(109, 92, 231\))$/u);
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart][data-pageroot-review-structure]',
    )).toHaveCount(1);
    const structureAddedRowFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="structure"][data-pageroot-review-semantic-owner="${addedRowSemanticOwner}"]`,
    );
    await expect(structureAddedRowFrame).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-pageroot-review-semantic-owner="${addedRowSemanticOwner}"]`,
    )).toHaveCount(0);
    await expect.poll(() => structureAddedRowFrame.evaluate((frame) => {
      const row = document.querySelector('[data-review-brand-row="added"]');
      if (!row) return false;
      const frameRect = frame.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return Math.abs(frameRect.left - (rowRect.left - 3)) < .75
        && Math.abs(frameRect.top - (rowRect.top - 3)) < .75
        && Math.abs(frameRect.width - (rowRect.width + 6)) < .75
        && Math.abs(frameRect.height - (rowRect.height + 6)) < .75;
    })).toBe(true);
    await expect(beforeReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-mixed-copy] [data-pageroot-review-structure], [data-review-break-layout] [data-pageroot-review-structure], [data-review-ebita-copy] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-mixed-copy] [data-pageroot-review-structure], [data-review-break-layout] [data-pageroot-review-structure], [data-review-ebita-copy] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator("[data-pageroot-review-style]")).toHaveCount(0);
      await expect(frame.locator(
        '[data-review-layout-only][data-pageroot-review-marker], [data-review-layout-only][data-pageroot-review-structure], [data-review-layout-only][data-pageroot-review-projection-facts]',
      )).toHaveCount(0);
      await expect(frame.locator(
        '[data-review-metrics] [data-pageroot-review-marker], [data-review-mask-stage] [data-pageroot-review-marker]',
      )).toHaveCount(0);
    }
    await launched.page.getByRole("button", {
      name: "只看修改前",
    }).click();
    await expect(launched.page.locator('[data-view="before"]')).toBeVisible();
    await expect(launched.page.locator('section[data-side="after"]')).toHaveAttribute("hidden", "");
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("structure");
    // Switching to a single page must widen it to the space available, never leave it at
    // the split width. Alignment of the right edges was the old way to say that, but it
    // silently assumed the scroll area is wider than the page: at 100% zoom a page wider
    // than its area legitimately overflows, and the conversation docked beside the review
    // makes that area narrower. The invariant is that the page is never the narrower one.
    await expect.poll(async () => {
      const viewport = await launched.page.locator('[aria-label="修改前画布滚动区"]').boundingBox();
      const frame = await launched.page.locator('iframe[title^="修改前"]').boundingBox();
      if (!viewport || !frame) return -100;
      return (frame.x + frame.width) - (viewport.x + viewport.width);
    }).toBeGreaterThanOrEqual(-2);
    await launched.page.getByRole("button", {
      name: "双页对比",
    }).click();
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("structure");
    const wholePageButton = launched.page.getByRole("button", {
      name: "双页对比",
    });
    await wholePageButton.focus();
    await wholePageButton.press("ArrowRight");
    await expect(launched.page.locator('[data-view="before"]')).toBeVisible();
    const leftPageButton = launched.page.getByRole("button", {
      name: "只看修改前",
    });
    await expect(leftPageButton).toBeFocused();
    await leftPageButton.press("ArrowLeft");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(wholePageButton).toBeFocused();
    await launched.page.getByRole("button", {
      name: "只看修改后",
    }).click();
    await expect(launched.page.locator('[data-view="after"]')).toBeVisible();
    await expect(launched.page.locator('section[data-side="before"]')).toHaveAttribute("hidden", "");
    await launched.page.getByRole("button", { name: "全部变化" }).click();
    await expect(launched.page.locator('[data-view="after"]')).toBeVisible();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("all");
    await wholePageButton.click();
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect.poll(async () => {
      const grid = await launched.page.locator('[data-view="split"]').boundingBox();
      const beforePane = await launched.page.locator('section[data-side="before"]').boundingBox();
      const afterPane = await launched.page.locator('section[data-side="after"]').boundingBox();
      if (!grid || !beforePane || !afterPane) return false;
      return beforePane.x - grid.x <= 4
        && grid.x + grid.width - (afterPane.x + afterPane.width) <= 4
        && afterPane.x - (beforePane.x + beforePane.width) <= 4;
    }).toBe(true);
    const crossLineProjectionState = () => afterReviewFrame.locator("html").evaluate(() => {
        const marker = document.querySelector(
          '[data-review-cross-line] [data-pageroot-review-text="added"]',
        );
        if (!marker) return { matches: false, reason: "marker-missing" };
        const groupId = marker.getAttribute("data-pageroot-review-text-group") || "";
        const range = document.createRange();
        range.selectNodeContents(marker);
        const rangeRectCount = [...range.getClientRects()]
          .filter((rect) => rect.width > 1 && rect.height > 1).length;
        range.detach();
        const frames = [...document.querySelectorAll(
          '[data-pageroot-review-overlay-box][data-text-group="' + groupId + '"]',
        )];
        const labelCount = frames.filter((frame) => (
          frame.querySelector("[data-pageroot-review-overlay-label]")
        )).length;
        const framesArePlain = frames.every((frame) => (
            frame.getAttribute("data-shaped") !== "true"
            && frame.getAttribute("data-pageroot-review-fragment-count") === "1"
        ));
        return {
          matches: frames.length === 1
            && frames[0]?.getAttribute("data-scope") === "text-block"
            && labelCount <= 1
            && framesArePlain,
          rangeRectCount,
          frameCount: frames.length,
          scopes: frames.map((frame) => frame.getAttribute("data-scope")),
          labelCount,
          framesArePlain,
          filter: document.documentElement.dataset.pagerootReviewFilter,
        };
      });
    const promotedScopeProjectionState = () => afterReviewFrame.locator("html").evaluate(() => {
      const inspect = (ownerSelector, expectedScope, expectedMarkers, expectedGroups) => {
        const owner = document.querySelector(ownerSelector);
        const markers = owner
          ? [...owner.querySelectorAll('[data-pageroot-review-text="added"]')]
          : [];
        const semanticOwnerId = markers[0]?.getAttribute(
          "data-pageroot-review-semantic-owner",
        ) || "";
        const frames = semanticOwnerId ? [...document.querySelectorAll(
          '[data-pageroot-review-overlay-box][data-tone="text-added"]'
            + '[data-pageroot-review-semantic-owner="' + semanticOwnerId + '"]',
        )] : [];
        const holes = semanticOwnerId ? [...document.querySelectorAll(
          '[data-pageroot-review-mask-hole]'
            + '[data-pageroot-review-semantic-owner="' + semanticOwnerId + '"]',
        )] : [];
        const groups = new Set(markers.map((marker) => (
          marker.getAttribute("data-pageroot-review-text-group") || ""
        )).filter(Boolean));
        const frame = frames[0];
        const hole = holes[0];
        const geometryMatches = Boolean(frame && hole && [
          "data-left",
          "data-top",
          "data-width",
          "data-height",
        ].every((attribute) => (
          Math.abs(Number(frame.getAttribute(attribute)) - Number(hole.getAttribute(attribute)))
            < .01
        )));
        const frameGroups = new Set((frame?.getAttribute("data-text-groups") || "")
          .split(/\s+/).filter(Boolean));
        return {
          matches: markers.length === expectedMarkers
            && groups.size === expectedGroups
            && frames.length === 1
            && holes.length === 1
            && frame?.getAttribute("data-scope") === expectedScope
            && frame?.getAttribute("data-shaped") !== "true"
            && frame?.getAttribute("data-pageroot-review-fragment-count") === "1"
            && frameGroups.size === groups.size
            && [...groups].every((group) => frameGroups.has(group))
            && geometryMatches,
          markerCount: markers.length,
          groupCount: groups.size,
          frameCount: frames.length,
          holeCount: holes.length,
          scope: frame?.getAttribute("data-scope") || "",
          geometryMatches,
        };
      };
      const line = inspect("[data-review-line-scope]", "text-line", 2, 2);
      const paragraph = inspect("[data-review-scope-promotion]", "text-block", 9, 9);
      return { matches: line.matches && paragraph.matches, line, paragraph };
    });
    await launched.page.getByRole("button", { name: "适应画布", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "适应画布", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    // At "适应" the counter-scaled captions reach further, so same-caption
    // regions whose anchors crowd must collapse into one counted
    // "{caption} ×N" representative: no two identical captions may overlap,
    // and every counted caption names its own cluster total.
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => {
      const labels = [...document.querySelectorAll("[data-pageroot-review-overlay-label]")];
      const wellFormed = labels
        .filter((label) => label.hasAttribute("data-pageroot-review-label-count"))
        .every((label) => {
          const count = Number(label.getAttribute("data-pageroot-review-label-count"));
          return count >= 2 && new RegExp(" ×" + count + "$", "u").test(label.textContent || "");
        });
      const entries = labels.map((label) => ({
        text: label.textContent || "",
        rect: label.getBoundingClientRect(),
      }));
      const sameCaptionOverlap = entries.some((left, leftIndex) => entries.some((right, rightIndex) => (
        leftIndex < rightIndex
        && left.text === right.text
        && Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left) > 1
        && Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top) > 1
      )));
      return { hasLabels: labels.length > 0, wellFormed, sameCaptionOverlap };
    })).toMatchObject({ hasLabels: true, wellFormed: true, sameCaptionOverlap: false });
    await expect.poll(crossLineProjectionState).toMatchObject({ matches: true });
    await expect.poll(promotedScopeProjectionState).toMatchObject({ matches: true });
    await expect.poll(() => assertOverlayMaskEquivalence(afterReviewFrame)).toBe(true);
    await launched.page.getByRole("button", { name: "原始大小", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "原始大小", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(crossLineProjectionState).toMatchObject({ matches: true });
    await expect.poll(promotedScopeProjectionState).toMatchObject({ matches: true });
    const originalWindowBounds = await launched.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ));
      return window?.getBounds() || null;
    });
    expect(originalWindowBounds).toBeTruthy();
    const originalViewportWidth = await launched.page.evaluate(() => innerWidth);
    const resizedBounds = { ...originalWindowBounds, width: originalWindowBounds.width + 180 };
    await launched.electronApp.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ))?.setBounds(bounds, false);
    }, resizedBounds);
    await expect.poll(() => launched.page.evaluate(
      (original) => innerWidth - original >= 120,
      originalViewportWidth,
    )).toBe(true);
    await expect.poll(crossLineProjectionState).toMatchObject({ matches: true });
    await expect.poll(promotedScopeProjectionState).toMatchObject({ matches: true });
    await expect.poll(() => assertOverlayMaskEquivalence(afterReviewFrame)).toBe(true);
    await launched.electronApp.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ))?.setBounds(bounds, false);
    }, originalWindowBounds);
    await expect.poll(() => launched.page.evaluate(
      (original) => Math.abs(innerWidth - original) <= 2,
      originalViewportWidth,
    )).toBe(true);
    await expect.poll(crossLineProjectionState).toMatchObject({ matches: true });
    await expect.poll(promotedScopeProjectionState).toMatchObject({ matches: true });
    const beforeViewport = launched.page.locator('[aria-label="修改前画布滚动区"]');
    const afterViewport = launched.page.locator('[aria-label="修改后画布滚动区"]');
    await launched.page.waitForTimeout(450);
    const sourceLeft = await beforeViewport.evaluate((element) => {
      element.scrollLeft = Math.max(1, Math.round(
        (element.scrollWidth - element.clientWidth) * .35,
      ));
      element.dispatchEvent(new Event("scroll"));
      return element.scrollLeft;
    });
    expect(sourceLeft).toBeGreaterThan(0);
    await expect.poll(() => afterViewport.evaluate((element) => element.scrollLeft))
      .toBe(sourceLeft);

    // A trackpad swipe lands inside the frame, where the vertically scrollable
    // document keeps the horizontal component of the gesture and drops it. The
    // pane has to take that remainder, exactly once, or the first horizontal
    // swipe is lost and the second one moves both pages twice as far.
    const frameHorizontalCapacity = await beforeReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollWidth - innerWidth)
    ));
    expect(frameHorizontalCapacity).toBeLessThanOrEqual(1);
    const paneMaximum = await beforeViewport.evaluate((element) => (
      element.scrollWidth - element.clientWidth
    ));
    const swipedLeft = Math.min(paneMaximum, sourceLeft + 90);
    expect(swipedLeft).toBeGreaterThan(sourceLeft);
    const paneBox = await beforeViewport.boundingBox();
    await launched.page.mouse.move(
      paneBox.x + paneBox.width / 2,
      paneBox.y + paneBox.height / 2,
    );
    await launched.page.mouse.wheel(90, 24);
    await expect.poll(() => beforeViewport.evaluate((element) => element.scrollLeft))
      .toBe(swipedLeft);
    await expect.poll(() => afterViewport.evaluate((element) => element.scrollLeft))
      .toBe(swipedLeft);

    // At the page end the browser stops on the real scroll maximum, which a
    // scrollbar-shortened measurement underreports. A synchronizer that trusts
    // the short value drags the other page backwards while the user is still
    // scrolling forwards.
    const hoverPane = async (viewport) => {
      const paneBounds = await viewport.boundingBox();
      await launched.page.mouse.move(
        paneBounds.x + paneBounds.width / 2,
        paneBounds.y + paneBounds.height / 2,
      );
    };
    const frameScrollState = (frame) => frame.locator("html").evaluate(() => ({
      top: Math.round(scrollY),
      remaining: Math.round(Math.max(
        0,
        document.documentElement.scrollHeight
        - document.documentElement.clientHeight
        - scrollY,
      )),
    }));
    // The page-end check only means something when both pages start from the
    // same place: an earlier harness-driven scrollIntoView can leave the two
    // documents at different offsets, and the next gesture would carry that
    // gap to the page end as a fixed takeover offset.
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await frame.locator("html").evaluate(() => window.scrollTo(0, 0));
    }
    await expect.poll(async () => (await Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => (
        frame.locator("html").evaluate(() => Math.round(scrollY))
      )),
    )).reduce((total, top) => total + top, 0)).toBe(0);
    await launched.page.waitForTimeout(240);
    await hoverPane(beforeViewport);
    for (let index = 0; index < 9; index += 1) {
      await launched.page.mouse.wheel(0, 900);
      await launched.page.waitForTimeout(120);
    }
    await expect.poll(async () => (await frameScrollState(beforeReviewFrame)).remaining)
      .toBeLessThanOrEqual(1);
    const leaderAtPageEnd = await frameScrollState(beforeReviewFrame);
    await hoverPane(afterViewport);
    await launched.page.mouse.wheel(0, 150);
    await launched.page.waitForTimeout(240);
    expect((await frameScrollState(afterReviewFrame)).remaining).toBeLessThanOrEqual(1);
    expect((await frameScrollState(beforeReviewFrame)).top).toBe(leaderAtPageEnd.top);
    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      window.scrollTo(0, 0);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBe(0);

    const originalAfterMaximum = await afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ));
    await afterReviewFrame.locator("html").evaluate(() => {
      const spacer = document.createElement("div");
      spacer.setAttribute("data-review-sync-height-probe", "true");
      spacer.style.height = "1600px";
      spacer.style.pointerEvents = "none";
      document.body.append(spacer);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ))).toBeGreaterThan(originalAfterMaximum + 1_400);
    await launched.page.waitForTimeout(180);
    await beforeReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_600 }));
      window.scrollTo(0, maximum);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBeGreaterThan(1);
    const unequalHeightFollowerSamples = [];
    for (let index = 0; index < 8; index += 1) {
      await launched.page.waitForTimeout(20);
      unequalHeightFollowerSamples.push(await afterReviewFrame.locator("html").evaluate(
        () => window.scrollY,
      ));
    }
    const settledUnequalHeightFollowerSamples = unequalHeightFollowerSamples.slice(-5);
    expect(
      Math.max(...settledUnequalHeightFollowerSamples)
        - Math.min(...settledUnequalHeightFollowerSamples),
    ).toBeLessThanOrEqual(1);
    const unequalHeightFollower = await afterReviewFrame.locator("html").evaluate(() => ({
      top: scrollY,
      maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    }));
    expect(unequalHeightFollower.maximum - unequalHeightFollower.top).toBeGreaterThan(1_000);
    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_200 }));
    });
    await launched.page.waitForTimeout(160);
    expect(await afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBeCloseTo(unequalHeightFollower.top, 0);
    await afterReviewFrame.locator('[data-review-sync-height-probe="true"]')
      .evaluate((spacer) => spacer.remove());
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ))).toBe(originalAfterMaximum);

    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      window.scrollTo(0, 0);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBe(0);
    await launched.page.waitForTimeout(180);
    const sourceScrollResult = await beforeReviewFrame.locator("html").evaluate(() => {
      const outlines = [...document.querySelectorAll("[data-pageroot-outline-id]")]
        .filter((element) => element.getBoundingClientRect().height > 0);
      const target = outlines[Math.floor(outlines.length / 2)];
      if (!target) return { maximum: 0, target: 0, actual: scrollY, count: 0 };
      const rect = target.getBoundingClientRect();
      const nextTop = scrollY + rect.top + rect.height / 2 - innerHeight / 3;
      dispatchEvent(new WheelEvent("wheel", { deltaY: 900 }));
      window.scrollTo(0, nextTop);
      return {
        maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        target: nextTop,
        actual: scrollY,
        count: outlines.length,
      };
    });
    const followerScrollMetrics = await afterReviewFrame.locator("html").evaluate(() => ({
      maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      actual: scrollY,
    }));
    expect(sourceScrollResult.actual).toBeGreaterThan(1);
    expect(followerScrollMetrics.maximum).toBeGreaterThan(1);
    const followerScrollSamples = [];
    for (let index = 0; index < 8; index += 1) {
      await launched.page.waitForTimeout(20);
      followerScrollSamples.push(await afterReviewFrame.locator("html").evaluate(
        () => window.scrollY,
      ));
    }
    expect(followerScrollSamples.at(-1)).toBeGreaterThan(1);
    const settledFollowerSamples = followerScrollSamples.slice(-5);
    expect(Math.max(...settledFollowerSamples) - Math.min(...settledFollowerSamples))
      .toBeLessThanOrEqual(1);
    const referenceOutlineAnchor = (frame) => frame.locator("html").evaluate(() => {
      const referenceLine = innerHeight / 3;
      const outlines = [...document.querySelectorAll("[data-pageroot-outline-id]")]
        .filter((element) => element.getBoundingClientRect().height > 0);
      const anchor = outlines.find((element) => element.getBoundingClientRect().bottom > referenceLine)
        || outlines.at(-1);
      if (!anchor) return { outlineId: "", ratio: 0 };
      const rect = anchor.getBoundingClientRect();
      return {
        outlineId: anchor.getAttribute("data-pageroot-outline-id") || "",
        ratio: Math.max(0, Math.min(1, (referenceLine - rect.top) / Math.max(1, rect.height))),
      };
    });
    const beforeOutlineAnchor = await referenceOutlineAnchor(beforeReviewFrame);
    expect(beforeOutlineAnchor.outlineId).not.toBe("");
    const afterOutlineProgress = () => afterReviewFrame.locator(
      `[data-pageroot-outline-id="${beforeOutlineAnchor.outlineId}"]`,
    ).evaluate((element) => {
      const referenceLine = innerHeight / 3;
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.min(1, (referenceLine - rect.top) / Math.max(1, rect.height)));
    });
    await expect.poll(afterOutlineProgress).toBeCloseTo(beforeOutlineAnchor.ratio, 1);

    await beforeReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_600 }));
      window.scrollTo(0, maximum * .82);
      window.scrollTo(0, maximum * .26);
    });
    const reversalSamples = [];
    for (let index = 0; index < 7; index += 1) {
      await launched.page.waitForTimeout(20);
      reversalSamples.push(await afterReviewFrame.locator("html").evaluate(() => window.scrollY));
    }
    const settledReversalSamples = reversalSamples.slice(-4);
    expect(Math.max(...settledReversalSamples) - Math.min(...settledReversalSamples))
      .toBeLessThanOrEqual(1);

    await afterReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: -900 }));
      window.scrollTo(0, maximum * .18);
    });
    const sideSwitchSamples = [];
    for (let index = 0; index < 7; index += 1) {
      await launched.page.waitForTimeout(20);
      sideSwitchSamples.push(await beforeReviewFrame.locator("html").evaluate(() => window.scrollY));
    }
    const settledSideSwitchSamples = sideSwitchSamples.slice(-4);
    expect(Math.max(...settledSideSwitchSamples) - Math.min(...settledSideSwitchSamples))
      .toBeLessThanOrEqual(1);

    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: -1_200 }));
      window.scrollTo(0, 0);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBe(0);
    await beforeReviewFrame.locator("html").evaluate(() => {
      window.scrollTo(0, 0);
      dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
    });
    await launched.page.waitForTimeout(120);
    expect(await afterReviewFrame.locator("html").evaluate(() => window.scrollY)).toBe(0);
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.getByRole("slider", {
        name: "非修改区域上下文可见度",
      }).fill("18");
      await wholePageButton.click();
      await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
        "data-pageroot-review-filter",
      )).toBe("all");
      await Promise.all([
        beforeViewport.evaluate((element) => { element.scrollLeft = 0; }),
        afterViewport.evaluate((element) => { element.scrollLeft = 0; }),
        beforeReviewFrame.locator("html").evaluate(() => window.scrollTo(0, 0)),
        afterReviewFrame.locator("html").evaluate(() => window.scrollTo(0, 0)),
      ]);
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-final.png"),
        animations: "disabled",
      });
    }
    await launched.page.getByRole("button", {
      name: "采纳修改",
    }).click();
    await expect(launched.page.getByRole("dialog", {
      name: /采纳 AI 修改后（.+）？/u,
    })).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "继续审阅" }))
      .toBeFocused();
    await launched.page.evaluate(() => {
      window.__pagerootSawHandoffFlash = false;
      window.__pagerootHandoffFlashEvents = [];
      // Accepting promotes the Working Copy to a new source path while the
      // review overlay is still visible. The overlay must keep its prepared
      // session identity: a review iframe remounting mid-accept is the
      // user-visible double-jump regression.
      window.__pagerootReviewAcceptFrames = Array.from(document.querySelectorAll(
        '[data-testid="ai-review-workspace"] iframe',
      ));
      window.__pagerootHandoffObserver = new MutationObserver(() => {
        const panel = document.querySelector(".handoff-panel");
        const review = document.querySelector('[data-testid="ai-review-workspace"]');
        const reviewCoversWindow = Boolean(
          review
          && review.getClientRects().length > 0
          && getComputedStyle(review).position === "fixed",
        );
        if (panel && panel.getClientRects().length > 0 && !reviewCoversWindow) {
          window.__pagerootSawHandoffFlash = true;
          window.__pagerootHandoffFlashEvents.push({
            panelText: panel.textContent?.slice(0, 120) || "",
            reviewPresent: Boolean(review),
            drawer: document.querySelector(".side-drawer")?.getAttribute("data-drawer") || "",
            sourceTitle: document.querySelector('.workbench-tab[data-selected="true"] button[role="tab"] > span:last-child')?.textContent || "",
          });
        }
        const disconnectedFrames = reviewCoversWindow
          ? window.__pagerootReviewAcceptFrames.filter((frame) => !frame.isConnected)
          : [];
        if (disconnectedFrames.length > 0) {
          window.__pagerootReviewAcceptFrames = window.__pagerootReviewAcceptFrames
            .filter((frame) => frame.isConnected);
          window.__pagerootHandoffFlashEvents.push({
            reviewFramesRemounted: disconnectedFrames.length,
            sourceTitle: document.querySelector('.workbench-tab[data-selected="true"] button[role="tab"] > span:last-child')?.textContent || "",
          });
        }
      });
      window.__pagerootHandoffObserver.observe(document.body, { childList: true, subtree: true });
    });
    expect(await launched.page.evaluate(
      () => window.__pagerootReviewAcceptFrames.length,
    )).toBe(2);
    await launched.page.getByRole("button", { name: "确认并采纳" }).click();
    const opened = await assertReviewAcceptPersistence({
      page: launched.page,
      sourcePath: fixture.sourcePath,
      original: fixture.original,
      expectedText: UPDATED_TEXT,
      versionPathPattern: /\/generated-ai-loop-V2(?:-V2)*\.html$/u,
    });
    expect(await launched.page.evaluate(() => {
      window.__pagerootHandoffObserver?.disconnect();
      return window.__pagerootHandoffFlashEvents;
    })).toEqual([]);
    await expect(launched.page.locator(".handoff-panel").filter({ visible: true }))
      .toHaveCount(0);
    const openedFrame = await loadedDiskFrame(launched.page, opened.sourcePath);
    await expect(openedFrame.locator(caseSelector("list-item")))
      .toHaveText(UPDATED_TEXT);

    await expect(launched.page.locator(".save-status"))
      .toHaveText("已安全保存", { timeout: 30_000 });
    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    const previewFrame = launched.page.frameLocator(
      'iframe[title="HTML 交互预览"]',
    );
    await expect(previewFrame.locator(caseSelector("list-item")))
      .toHaveText(UPDATED_TEXT, { timeout: 30_000 });
    await expect(launched.page.locator(".save-status"))
      .toHaveText("已安全保存", { timeout: 30_000 });
    await launched.page.getByRole("button", { name: "编辑", exact: true }).click();

    await launched.electronApp.evaluate(({ dialog }, sourcePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [sourcePath],
      });
    }, pickerSourcePath);
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    if (await sidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    }
    await sidebar.getByRole("button", { name: "打开 HTML", exact: true }).click();
    const pickerFrame = await loadedDiskFrame(
      launched.page,
      pickerSourcePath,
    );
    await expect(pickerFrame.locator(caseSelector("list-item")))
      .toHaveText(PICKER_TEXT);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("two AI versions activate in order and survive relaunch without identity drift", async () => {
  test.setTimeout(240_000);
  const fixture = createSourceFixture("sequential-ai-loop.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  let activeApp = launched.electronApp;
  let activeAppClosed = false;
  try {
    const firstRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      firstRequest.requestRoot,
      (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    );
    runOfficialFinalizer(firstRequest.requestRoot, firstRequest.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/sequential-ai-loop-V2\.html$/u),
    });
    const firstActive = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect((await loadedDiskFrame(
      launched.page,
      firstActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(UPDATED_TEXT);

    const secondRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      firstActive.sourcePath,
      SECOND_UPDATED_TEXT,
    );
    writeAiOutput(
      secondRequest.requestRoot,
      (base) => base.replace(UPDATED_TEXT, SECOND_UPDATED_TEXT),
    );
    runOfficialFinalizer(secondRequest.requestRoot, secondRequest.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/sequential-ai-loop-V3\.html$/u),
    });
    const secondActive = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(readFileSync(firstActive.sourcePath, "utf8")).toContain(UPDATED_TEXT);
    expect(readFileSync(firstActive.sourcePath, "utf8"))
      .not.toContain(SECOND_UPDATED_TEXT);
    expect(readFileSync(secondActive.sourcePath, "utf8"))
      .toContain(SECOND_UPDATED_TEXT);
    await expect((await loadedDiskFrame(
      launched.page,
      secondActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(SECOND_UPDATED_TEXT);

    const projectRoot = managedProjectRootForId(
      launched.workspace,
      secondRequest.changeRequest.projectId,
    );
    expect(projectRoot).toBeTruthy();
    const manifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(manifest.projectId).toBe(secondRequest.changeRequest.projectId);
    expect(manifest.latestOfficialVersionId).toBe("ver_0003");
    expect(manifest.versions.map((version) => version.versionId))
      .toEqual(["ver_0001", "ver_0002", "ver_0003"]);

    await closePageRootGracefully(launched.electronApp, launched.page);
    activeAppClosed = true;
    const relaunched = await launchPageRoot({
      isolatedUserData: launched.isolatedUserData,
    });
    activeApp = relaunched.electronApp;
    activeAppClosed = false;
    await expect.poll(async () => (
      relaunched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: secondActive.sourcePath,
    });
    await expect((await loadedDiskFrame(
      relaunched.page,
      secondActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(SECOND_UPDATED_TEXT);
  } finally {
    if (activeAppClosed) {
      removeAiLoopUserData(launched.isolatedUserData);
    } else {
      await stopPageRoot(activeApp, launched.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("returning from review restores the editable pre-AI version and preserves the candidate", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("return-before-ai.html");
  const commentText = `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`;
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      request.requestRoot,
      (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    );
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    const candidateFiles = candidateHtmlFiles(
      launched.workspace,
      request.changeRequest.projectId,
    );
    expect(candidateFiles).toHaveLength(1);
    expect(readFileSync(candidateFiles[0], "utf8")).toContain(UPDATED_TEXT);

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "返回修改前" }).click();
    const dialog = launched.page.getByRole("dialog", {
      name: /返回 AI 修改前（版本 \d+）？/u,
    });
    await expect(dialog).toBeVisible();
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-return-confirmation.png"),
        animations: "disabled",
      });
    }
    await expect(dialog.getByText(/确认后不会采用这次 AI 返回的 版本 \d+。/u))
      .toBeVisible();
    await expect(dialog.getByText(/将继续使用 版本 \d+（AI 修改前）为基线重新修改。/u))
      .toBeVisible();
    const projectRoot = managedProjectRootForId(
      launched.workspace,
      request.changeRequest.projectId,
    );
    expect(projectRoot).toBeTruthy();
    const aiTasksRoot = path.join(projectRoot, "AI任务");
    rmSync(aiTasksRoot, { recursive: true, force: true });
    const revealCandidateTask = dialog.getByRole("button", {
      name: "AI 返回的 HTML 已自动保留，点击在文件夹中打开。",
    });
    await expect(revealCandidateTask).toBeVisible();
    await revealCandidateTask.click();
    await expect.poll(() => existsSync(aiTasksRoot), { timeout: 30_000 }).toBe(true);
    const [returnBackground, continueBackground] = await Promise.all([
      dialog.getByRole("button", { name: "返回修改前版本" })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      dialog.getByRole("button", { name: "继续审阅" })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    expect(returnBackground).not.toBe(continueBackground);
    await dialog.getByRole("button", { name: "返回修改前版本" }).click();

    await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
    const [workingCopyPath] = workingHtmlFiles(
      launched.workspace,
      request.changeRequest.projectId,
    );
    await loadedDiskFrame(launched.page, workingCopyPath);
    await expect(launched.page.locator(".comment-card").filter({ hasText: commentText }))
      .toHaveCount(1);
    const restored = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(restored.sourcePath).toBe(realpathSync(workingCopyPath));
    const runtime = JSON.parse(readFileSync(path.join(
      projectRoot,
      ".pageroot",
      "runtime-state.json",
    ), "utf8"));
    expect(runtime.schemaVersion).toBe("4.0.0");
    expect(runtime.activeRequest).toBeNull();
    expect(runtime.activeCandidateId).toBeNull();
    const candidate = JSON.parse(readFileSync(
      path.join(request.requestRoot, "candidate.json"),
      "utf8",
    ));
    const requestRecord = JSON.parse(readFileSync(
      path.join(request.requestRoot, "request.json"),
      "utf8",
    ));
    expect(candidate.status).toBe("rejected");
    expect(requestRecord.status).toBe("rejected");
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(existsSync(candidateFiles[0])).toBe(true);
    expect(readFileSync(candidateFiles[0], "utf8")).toContain(UPDATED_TEXT);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a broad but related AI return is accepted without a target-scope error", {
  tag: ["@gate-smoke","@smoke-review"],
}, async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base
      .replace(ORIGINAL_TEXT, UPDATED_TEXT)
      .replace(
        "<title>PageRoot native DOM editing matrix</title>",
        "<title>unauthorized title mutation</title>",
      ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await expect(launched.page.getByText("已记录评论范围外的额外变化", { exact: true }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采用这些额外变化" }))
      .toHaveCount(0);
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(active.sourcePath).toBe(realpathSync(
      workingHtmlFiles(launched.workspace, request.changeRequest.projectId)[0],
    ));
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a committed version that the desktop cannot activate stays visibly blocked", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: { PAGEROOT_E2E_GENERATED_VERSION_OPEN_FAILURE: "1" },
  });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });
    await adoptReadyResult(launched.page);
    await expect(launched.page.getByText(/新版本文件暂时无法打开|最新版暂时无法打开/u)
      .filter({ visible: true }).first())
      .toBeVisible({ timeout: 30_000 });
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).toBe(realpathSync(request.sourcePath));
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(2);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a rewrite outside <main> is still reviewed", {
  tag: ["@gate-smoke","@smoke-review"],
}, async () => {
  // A single-file page has no site chrome to skip: the reader can comment on a
  // footer note, the AI can rewrite it, and the review must show that change
  // instead of reporting the page as unchanged there.
  const fixture = createSourceFixture(
    "outside-main-review.html",
    (source) => source.replace(
      "</body>",
      `  <footer data-review-outside-main>
    <p>${OUTSIDE_MAIN_BEFORE}</p>
  </footer>
</body>`,
    ),
  );
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => {
      expect(base).toContain(OUTSIDE_MAIN_BEFORE);
      return base
        .replace(ORIGINAL_TEXT, UPDATED_TEXT)
        .replace(OUTSIDE_MAIN_BEFORE, OUTSIDE_MAIN_AFTER);
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("等待你的决定", { timeout: 30_000 });

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const beforeReviewFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterReviewFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator("html")).toHaveAttribute(
        "data-pageroot-review-filter",
        "all",
        { timeout: 30_000 },
      );
    }
    // The footer is a body-level sibling of <main>, so it must become its own
    // change region carrying text evidence on both sides.
    await expect(beforeReviewFrame.locator("[data-review-outside-main]"))
      .toHaveAttribute("data-pageroot-review-types", /text/u, { timeout: 30_000 });
    await expect(afterReviewFrame.locator("[data-review-outside-main]"))
      .toHaveAttribute("data-pageroot-review-types", /text/u);
    await expect(beforeReviewFrame.locator(
      '[data-review-outside-main] [data-pageroot-review-text="removed"]',
    ).filter({ hasText: "不同" }).first()).toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-review-outside-main] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "一致" }).first()).toBeVisible();
    // 品牌与 About 入口由全局侧边栏统一承担，审阅页不复制同形顶栏图标。
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    if (await sidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    }
    await sidebar.getByRole("button", { name: "源页", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "关闭关于源页" }))
      .toBeVisible({ timeout: 15_000 });
    await launched.page.getByRole("button", { name: "关闭关于源页" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
