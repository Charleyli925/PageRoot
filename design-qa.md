# Design QA

## 真实复杂 HTML 完整对照

Date: 2026-08-01

Source visual truth:

- `local-only attachment / codex-clipboard-f863824d-12c6-49bc-8b88-017f916f18ef.png`
  — 用户提供的原审阅页实拍，用于核对顶部栏、浅灰画布、白色内容纸张、紫色结构语义与右侧固定决策栏。
- `local-only source HTML / 复杂HTML综合测试页.html`
  — 本轮真实内容与视觉基线。原版 Demo 资产的 SHA-256 为 `9075e126f270b41c0320f1f5dd761e1eaf0cf645ec20850e61462583a52618dc`，与该文件逐字节一致；候选版由原版执行 7 组受检修改得到。
- 原版与候选版只生成在被 Git 忽略的 `public/review-demo-local/` 中，不进入版本库。

Implementation evidence:

- `session visualization / complex-real-html-review/01-original-html.png`
- `session visualization / complex-real-html-review/03-candidate-html.png`
- `session visualization / complex-real-html-review/04-review-dashboard-post-fix.png`

Viewport and normalization:

- User review screenshot: `2040 × 1630` pixels; original CSS viewport and density are unavailable, so it is treated as a visual-language reference rather than a pixel-perfect same-state target.
- Original HTML, candidate HTML and review implementation: `1280 × 720` CSS viewport, runtime `devicePixelRatio = 2`; in-app Browser screenshots are normalized to `1280 × 720` output pixels.
- State: implementation shows `对照` mode on the real `#dashboard` section, with both complete documents loaded and independently scrollable.
- The user screenshot and rendered implementation were opened together in one visual comparison input. A second combined input placed the standalone original HTML and rendered review implementation together to verify that the real source styling survives inside the comparison frames.

Full-view comparison evidence:

- Waiting state now renders the complete original HTML rather than an invented report; the existing four-stage return flow and fixed right panel remain intact.
- Review state keeps the established PageRoot shell, but its main evidence area now loads `/review-demo-local/before.html#<anchor>` and `/review-demo-local/after.html#<anchor>` directly. The visible page title and anchor drive all seven jumps.
- `修改前` and `修改后` each show one full-width document; `对照` shows two real documents side by side. Each pane identifies provenance, byte/line size and provides a full-page open action.
- The explanatory mini-comparison remains below the real documents and is explicitly labeled `系统提炼的变化说明 / 最终以完整页面为准`, so it supports scanning without pretending to be the source of truth.

Focused comparison evidence:

- Original and candidate standalone captures confirm preservation of the source typography, grid, brand header and CSS-driven illustration; the candidate hero visibly contains the new title, two actions, content counts and `7 类真实修改` count.
- The post-fix dashboard review capture shows both real pages at the same `#dashboard` anchor. The original and candidate headings, sticky navigation and responsive wrapping are visibly derived from the supplied HTML, not recreated cards.
- DOM checks confirmed the exact candidate values `91.6 / 24 / 3.8 天 / 81%`, catalog order, five operations rows, four step legends, online media statuses and the reordered gallery classes.

Findings:

- No actionable P0, P1 or P2 issue remains.
- Fonts and typography: the review shell preserves the product system/PingFang hierarchy; iframe content uses the exact source document fonts and sizing. At the two-pane width the real document intentionally enters its own responsive layout rather than being illegibly scaled down.
- Spacing and layout rhythm: the source review shell retains its header, toolbar and persistent decision rail. Real-document provenance, frame and extracted explanation use a repeated 12–16px grouping rhythm with clear section boundaries.
- Colors and visual tokens: PageRoot indigo remains the structural/action color; red and green label before/after provenance without coloring the actual source content. The source Atlas palette is rendered untouched inside each frame.
- Image quality and asset fidelity: the original HTML is loaded directly, so its logo, CSS-driven sample artwork, embedded media placeholders and data-URI assets are preserved. No substitute illustration, custom SVG or placeholder image was introduced by the review UI.
- Copy and content: every map label comes from a visible heading or clearly marked content-derived name. The extracted summaries were checked against the actual generated HTML and corrected to use the real title, counts, chapter names, row status, form behavior and media order.
- Icons: all review-shell icons continue to use the existing Phosphor set; source-document controls remain native to the source HTML.
- Accessibility and state: view controls expose `aria-pressed`; the details control exposes `aria-expanded`; iframes have version-and-section titles; full-page links are semantic anchors; map buttons and decision actions remain keyboard-addressable.
- Responsive scope: the tested desktop viewport has no page-level overflow and keeps persistent actions visible. Each embedded page becomes responsive within its own pane and remains independently scrollable.

Primary interactions tested:

- Waiting → `模拟 AI 返回` → `审阅修改` loads two complete HTML documents.
- Selecting data, story and other content-map entries updates both iframe URLs to their corresponding real anchors and returns the review surface to the top.
- `修改后` produces one candidate iframe; returning to `对照` restores original plus candidate.
- Candidate form: selecting `large` reveals `高预算审批说明` and sets it to required.
- Candidate media: clicking Canvas shows `已保留当前波形点位`; both media status rows report connection state; the gallery order and Image Map regions are updated.
- Candidate standalone document has no console warning or error. The in-app Browser recorded one source-less `MutationObserver.observe(null)` error only while instrumenting the two sandboxed same-origin iframes; neither the review source nor generated HTML contains that observer, the error does not reproduce on the standalone documents, and all product interactions remain functional.

Comparison history:

1. First real-document integration exposed a P2 first-view issue: iframe anchor loading moved the outer review canvas down by 535px and hid the change title. The iframe load handler now restores the outer canvas to `scrollTop = 0`; post-fix evidence shows the change title and context first.
2. The first extracted summaries still contained invented counts, chapter merges, form behavior and row states from the earlier mock. They were corrected against the generated candidate DOM so every visible explanation now matches the complete HTML.
3. Post-fix combined visual evidence and interaction checks found no remaining P0/P1/P2 issue. Build, lint, typecheck and focused review tests pass.

Follow-up polish:

- P3: a production renderer should serve untrusted user HTML from a dedicated isolated origin instead of the same-origin local Demo path.
- P3: production can replace hard-coded byte/line labels with values from the generation manifest.

final result: passed

---

## 内容地图与自适应对照

Date: 2026-08-01

Source visual truth:

- `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-f863824d-12c6-49bc-8b88-017f916f18ef.png`
  — 用户提供的原审阅页实拍，作为 PageRoot 顶部栏、浅灰画布、白色内容纸张、紫色语义色与整体验证密度的视觉基线。
- `/Users/lizexuan/Desktop/复杂HTML综合测试页.html`
  — 只读结构依据。实现没有复制这份真实文件；Demo 数据由其可见标题、栏目类型与交互种类脱敏整理。
- 用户明确要求把“变化脊柱”改成用户能读懂的内容骨架，并用真实复杂页面的大改剧本替换通用技术术语；因此本轮是有意的信息架构改版，不做原截图逐像素复刻。

Implementation evidence:

- `/Users/lizexuan/.codex/visualizations/2026/07/31/019fb79d-e227-7901-a293-bcb645ae9516/complex-diff-audit/09-content-map-adaptive-compare-passed.png`
- `/Users/lizexuan/.codex/visualizations/2026/07/31/019fb79d-e227-7901-a293-bcb645ae9516/complex-diff-audit/06-adaptive-table-diff.png`
- `/Users/lizexuan/.codex/visualizations/2026/07/31/019fb79d-e227-7901-a293-bcb645ae9516/complex-diff-audit/05-adaptive-media-behavior.png`

Combined comparison input:

- The source screenshot and the final implementation screenshot were opened together in one visual comparison input before this report was written.
- Focused evidence uses the table and media screenshots above because those adaptive states do not exist in the original source capture.

Viewport and normalization:

- Source pixels: `2040 × 1630`, consistent with a `1020 × 815` Retina capture at 2× density.
- Implementation CSS viewport: `1280 × 720`; runtime `devicePixelRatio = 2`; the in-app Browser screenshot is normalized to `1280 × 720` pixels.
- State: source shows the old universal overlay; implementation shows the new content-map review with adaptive `完整前后`. The different state and aspect ratio are intentional, so the comparison judges retained visual language, hierarchy and clarity rather than false pixel parity.
- Final document geometry: `scrollWidth = clientWidth = 1280`, `scrollHeight = clientHeight = 720`. The content canvas and right map scroll independently.

Full-view comparison evidence:

- The new screen keeps the established 64px file bar, cool-gray workspace, centered white review surface, restrained borders, compact Phosphor icons and indigo PageRoot accent.
- The right rail now presents 12 user-recognizable content areas grouped as 页面开头、数据与阅读、项目与运营、媒体与文档、页面结尾. Ten labels come directly from visible headings; the footer uses visible brand text; the top navigation fallback is explicitly marked `根据内容命名`.
- The main surface replaces the old universal overlay with one repeated shell: content breadcrumb, user request, chosen comparison method, adaptive evidence and an expandable concrete-change list.

Focused comparison evidence:

- Whole-section rebuild uses two clean full snapshots instead of overlapping red/green surfaces.
- Layout changes use aligned before/after mini-layouts; article moves use chapter order; repeated cards use per-item add/delete/move labels; tables use row/column/cell summaries; forms use a user-action matrix; media changes pair visible layout with operation-result notes.
- Deletion, addition, movement and uncertain naming always include text labels, so meaning does not depend on color alone.

Findings:

- No actionable P0, P1 or P2 issue remains.
- Fonts and typography: the original PageRoot system/PingFang fallback and heavy report-title hierarchy are preserved. The first pass made map helper/state text too small at the `1280 × 720` target; final map headings are `10px`, helper/state labels are `8px`, and core request text is `10.5px`. Miniature page previews intentionally use smaller type because they are diagrams, not primary reading content.
- Spacing and layout rhythm: title, request, method, evidence and detail sections follow a stable vertical rhythm. The decision actions remain fixed and the content map scrolls without covering them.
- Colors and visual tokens: red remains removal, green addition, indigo structure/move and amber uncertain naming or extra AI work. Surfaces and shadows stay within the existing PageRoot palette.
- Image quality and asset fidelity: no new raster artwork is required by this information-design prototype. The real brand asset and project Phosphor icons are reused. Media tiles are labeled comparison miniatures for a source page that itself uses CSS-driven sample visuals; they are not substituted product imagery.
- Copy and content: the map uses visible Chinese headings from the supplied HTML rather than `hero`, `dashboard` or other implementation terms. The source-count copy was corrected from an inaccurate 11-title claim to `10 个名称直接来自页面标题`, plus one visible footer label and one explicit navigation fallback.
- Icons: all interface icons come from the existing Phosphor set and align to the surrounding label baseline.
- Accessibility and states: view buttons expose `aria-pressed`, detail disclosure exposes `aria-expanded`, unchanged map rows are disabled, the map has a navigation label, and reduced-motion handling remains present. All seven adaptive states include non-color labels.
- Responsive scope: this is a desktop-app prototype. At the tested target there is no page-level horizontal overflow. The pre-existing compact breakpoint that collapses to the review rail remains outside this scoped desktop exploration.

Interaction checks:

- Waiting → `模拟 AI 返回` → `审阅修改` reached the new review screen.
- All seven content-map changes opened their matching method: `完整前后`, `并排布局`, `顺序追踪`, `逐项清单`, `表格差异`, `表单与反馈`, `操作结果`.
- `修改前`, `修改后` and `对照` each showed the correct state; `只看有变化` hid unchanged areas and `显示完整页面` restored them.
- The concrete-change disclosure collapsed and reopened. `保留当前版本` opened its confirmation dialog and `继续审阅` returned safely.
- Browser console warning/error count: `0`. Only Vite connection and React development info logs were present.

Comparison history:

1. Initial rendered comparison preserved the product shell and passed core interactions, but exposed a P2 clarity/trust issue: right-map helper/state text was too small and the provenance note incorrectly claimed 11 direct headings.
2. Map typography was increased, group counts were rewritten as `N 处变化`, the rail header became `正在看第 N 处 · 共 7 处`, and provenance was corrected to ten headings plus footer text plus one explicit navigation fallback.
3. Final browser evidence at `1280 × 720` shows the corrected labels, no horizontal overflow, all seven adaptive methods and no browser warning/error. No actionable P0, P1 or P2 finding remains.

final result: passed

---

## 复杂叠加对比扩展

Date: 2026-07-31

Source visual truth:

- `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-f863824d-12c6-49bc-8b88-017f916f18ef.png`
  — 用户提供的当前“叠加对比”实拍，作为纸张层级、红删绿增、紫色修改标记、指标卡和页面密度的视觉基线。
- 用户明确认可现有叠加样式，并要求只扩展复杂差异的表现；等待页、返回页、修改前/后、右侧决策栏不在本轮视觉改动范围内。

Implementation evidence:

- `output/design-qa/ai-review-demo-complex/overlay-top.png`
- `output/design-qa/ai-review-demo-complex/overlay-cases-a.png`
- `output/design-qa/ai-review-demo-complex/overlay-cases-b.png`
- `output/design-qa/ai-review-demo-complex/overlay-cases-c.png`
- `output/design-qa/ai-review-demo-complex/overlay-normalized-1020x815.png`
- `output/design-qa/ai-review-demo-complex/overlay-responsive-1020x815.png`

Combined comparison inputs:

- `output/design-qa/ai-review-demo-complex/comparison-full.png`
- `output/design-qa/ai-review-demo-complex/comparison-focused.png`

Viewport and normalization:

- Source pixels: `2040 × 1630`; the capture is consistent with a `1020 × 815` CSS-pixel Retina viewport at 2× density.
- Source normalization: exact 50% downsample to `1020 × 815`, without crop or aspect-ratio change.
- Implementation normalized capture: explicit `1020 × 815` CSS viewport at `devicePixelRatio = 1`, saved as `1020 × 815` pixels.
- Full comparison: normalized source and implementation are placed side by side at equal pixel dimensions.
- Focused paper comparison: source paper crop `1620 × 1080` is downsampled to `810 × 540` and padded to `817 × 540`; implementation uses an `817 × 540` paper crop from the `1280 × 720` evidence. This comparison isolates hierarchy, typography, diff colors and metric-card rhythm from the persistent review rail.
- State: both captures show “叠加对比”. The source capture does not expose the right review rail, while the existing Demo deliberately keeps that rail persistent; this pre-existing, out-of-scope frame difference is excluded from fidelity judgment.

Full-view and focused comparison evidence:

- The existing headline, metric and moved-module treatments retain the source hierarchy; the new legend adds a compact semantic key without replacing the approved red/green inline treatment.
- Five complex examples continue the same white-paper surface, subtle gray separators, indigo structural cues, semantic red/green backgrounds and Phosphor icon treatment.
- The five scenarios cover word replacement plus style-only change, layout reprioritization, module add/delete/move, list reordering plus split/merge, and a whole-module story/component rebuild.
- At `1020 × 815`, the layout and whole-module pairs stack vertically, the report keeps independent scrolling, `documentElement.scrollWidth = clientWidth = 1020`, and no descendant has horizontal overflow.
- Focused comparison was required because the full frame makes the paper text too small for reliable typography and token judgment. The focused paper pair shows consistent title weight, rounded diff highlights, metric grid borders, purple pins and cool-gray section surfaces.

Findings:

- No actionable P0, P1 or P2 issue remains.
- Fonts and typography: the implementation preserves the existing system/PingFang fallback, compact small-label hierarchy and heavy report headings. Deleted and inserted text remain legible without losing unchanged sentence context.
- Spacing and layout rhythm: every new case uses a repeated number/header/content rhythm, aligned to the paper's established inset. Dense comparisons separate old and new states with borders and whitespace rather than additional chrome.
- Colors and visual tokens: red is reserved for removal, green for addition, and indigo for structural/style/movement semantics. These colors match the approved source treatment and remain visually distinct.
- Image quality and asset fidelity: no new raster artwork is required. The existing brand asset is preserved, and all visible symbols use the project's Phosphor icon set; no emoji, handcrafted SVG or CSS illustration was introduced.
- Copy and content: each complex case names both the change mechanism and its user meaning. The footer explicitly states that semantic grouping avoids presenting a move as an unrelated delete plus add.
- Expected difference: the implementation retains the previously approved right-side change rail and therefore gives the paper less full-frame width than the user capture. The user explicitly asked to leave other areas unchanged, so this was not treated as a regression.
- P3 follow-up: production data may require truncation rules for exceptionally long module names; the current stress-test copy fits at both checked widths.

Interaction checks:

- Waiting → `模拟 AI 返回` → `审阅修改` → `叠加对比` reached the expanded comparison.
- All five complex scenario headings and the semantic legend were present in the rendered accessibility tree.
- Switching to `修改后` and `修改前` removed the stress-test content (`0` matches); switching back to `叠加对比` restored it (`1` match).
- Persistent review actions and both version-decision buttons remained available.
- Browser console warnings and errors: none.

Comparison history:

1. The first equal-size full comparison confirmed the approved visual language but exposed the intentional frame difference caused by the pre-existing persistent review rail; no in-scope visual fix was required.
2. The focused paper comparison confirmed matching typography, diff tokens, metric rhythm and pin treatment. The new complex regions were then checked at `1280 × 720` and the responsive `1020 × 815` viewport; no actionable P0, P1 or P2 issue was found.

final result: passed

---

## AI 修改审阅交互 Demo

Date: 2026-07-31

Source visual truth:

- `/tmp/pageroot-review-audit.lIl2eJ/01-current-shell.png` — 当前 PageRoot
  浏览器工作台实拍，作为顶部文件栏、纸张画布、紫色语义色、控件圆角与整体密度的视觉基线。
- 这是现有产品的样式基线，不是同一业务状态的逐像素稿；新的“修改审阅”状态因此只比较设计语言与区域比例，不对正文内容做伪精确匹配。

Implementation evidence:

- `output/design-qa/ai-review-demo/01-waiting-1280x720.png`
- `output/design-qa/ai-review-demo/02-ready-1280x720.png`
- `output/design-qa/ai-review-demo/03-review-after-1280x720.png`
- `output/design-qa/ai-review-demo/04-review-overlay-1280x720.png`
- `output/design-qa/ai-review-demo/05-kept-outcome-1280x720.png`
- `output/design-qa/ai-review-demo/06-accepted-outcome-1280x720.png`

Combined comparison inputs:

- `output/design-qa/ai-review-demo/comparison-full-2560x720.jpg`
- `output/design-qa/ai-review-demo/comparison-header-2560x120.jpg`

Viewport and normalization:

- Source file: `1280 × 720` pixels. Its original CSS viewport and device density are unavailable, so it is used only as a same-size visual-language baseline.
- Implementation: `1280 × 720` CSS viewport, runtime `devicePixelRatio = 2`; the in-app browser screenshot API normalizes the saved evidence to `1280 × 720` pixels.
- Full comparison: source and implementation remain at equal `1280 × 720` pixel dimensions and are placed side by side without scaling.
- Focused comparison: equal top `1280 × 120` pixel header crops are placed side by side without scaling.
- State: source is the current read-only PageRoot shell; implementation is the new “修改后”审阅状态. Waiting, ready, overlay and both version decisions were checked separately.

Full-view and focused comparison evidence:

- The Demo keeps the existing white 64px-style top file bar, purple brand asset and semantic accent, cool-gray shell, centered paper surface and a clearly separated right rail.
- At `1280 × 720`, `body.scrollWidth = 1280` and `body.scrollHeight = 720`; no persistent control is outside the viewport. The report and change list scroll inside their own regions.
- The focused header comparison retains the product's two-line file identity, restrained mode/control surfaces, spacing rhythm, border color and icon treatment.
- The waiting and ready captures retain the existing four equal-stage handoff rhythm. The review capture intentionally gives more width to the paper and reserves a stable right rail for comment-to-change pairing.
- Focused region comparison was limited to the header because the source capture does not contain the proposed review rail; the rail was instead judged from its rendered screenshot and interaction states.

Findings:

- No actionable P0, P1 or P2 issue remains.
- Fonts and typography: the UI uses the existing system/PingFang fallback and the current product's compact hierarchy. Headings, metric emphasis, comments and action labels remain legible at the target viewport.
- Spacing and layout rhythm: header, toolbar, paper and rail align to stable horizontal boundaries. The main report and rail have independent scrolling, while both decision buttons remain visible.
- Colors and visual tokens: shell, paper, line, indigo, green and red diff colors follow the existing PageRoot palette and preserve semantic contrast.
- Image quality and asset fidelity: the existing `/public/brand-logo.png` is reused. All visible interface symbols use the project's Phosphor icon library; no emoji, handcrafted SVG, CSS illustration or placeholder asset was introduced.
- Copy and content: the flow consistently uses user-facing version language (`V1.3`, `候选 V1.4`, `当前 HTML`) and labels the route as a non-writing Demo. Comments, before/after content and the one extra AI change are paired in one rail.
- P3 follow-up: the right-rail explanatory copy is intentionally dense in this quick first pass; a production refinement could increase the smallest text by about 1px after real-content testing.

Interaction checks:

- Waiting → `模拟 AI 返回` → ready.
- Ready → `审阅修改`; `修改后`、`修改前`、`叠加对比` all changed the report state.
- Previous/next change navigation advanced the active change from `1 / 4` to `2 / 4`.
- `保留当前版本` opened a confirmation dialog; confirmation produced the V1.3-kept outcome while retaining candidate V1.4.
- `接受全部并打开` produced the V1.4-current outcome while retaining V1.3.
- `稍后处理` showed the intended persistence explanation; `直接打开` produced the explicit skip-review outcome.
- A fresh browser tab completed the full page load with no console warning or error. One earlier development tab recorded a transient dynamic-import error during Vinext dependency optimization; it did not reproduce after the server stabilized.

Comparison history:

1. The first normalized full and header comparisons found no actionable P0, P1 or P2 mismatch, so no visual fix iteration was required.
2. All core states were then exercised in the rendered browser. The final fresh-load check remained visually stable and console-clean.

final result: passed

---

## Workbench header height and overflow

Date: 2026-07-29

Source visual truth:

- `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-974aae8e-4a7d-462d-a653-2e355f6f0802.png`
  — user-provided macOS application capture showing the two-line file summary
  and primary actions touching or crossing the old header divider.
- The source attachment is local-only and remains outside the repository.
- User direction: preserve the existing header hierarchy and styling while
  adding enough height for every icon and label to remain inside the bar.
- User follow-up direction: add a diagonal default-browser action beside the
  filename plus action, give both icons concise upper-right hover hints, and
  keep the already approved header height unchanged.

Implementation evidence:

- `output/design-qa/2026-07-29-header-height/implementation-cdp-full.png`
- `output/design-qa/2026-07-29-header-height/implementation-compact-full.png`
- `output/design-qa/2026-07-29-header-file-actions/implementation-wide-open-tooltip.png`
- `output/design-qa/2026-07-29-header-file-actions/implementation-compact-browser-tooltip.png`

Combined comparison inputs:

- `output/design-qa/2026-07-29-header-height/comparison-source-vs-implementation.png`
- `output/design-qa/2026-07-29-header-height/comparison-actions-focused.png`

Viewport and normalization:

- Source pixels: `2872 × 182`, representing a `1436 × 91` CSS-pixel Retina
  application crop at 2× density.
- Wide implementation: `2560 × 1440` pixels from a `1280 × 720` CSS viewport
  at 2× density.
- Compact implementation: `1800 × 1440` pixels from a `900 × 720` CSS
  viewport at 2× density.
- The full comparison keeps the source at its native pixels and centers the
  implementation's top `2560 × 220` pixels in a same-width white comparison
  frame. The focused comparison uses native-density right-action crops.
- The source contains macOS traffic lights and a desktop project state. The
  browser implementation omits native window chrome and uses the read-only
  welcome project; those state differences are excluded from layout judgment.

Full-view and focused comparison evidence:

- The workbench header now measures exactly `88px`; the review stage begins at
  `y = 88px`, so the shared grid row and header box remain synchronized.
- Header padding computes to `30px 16px 12px 22px` at the wide viewport and
  `30px 12px 12px 20px` at the compact breakpoint.
- At both widths, every measured header descendant is inside the header.
  The lowest elements are the file metadata and send button at
  `y = 77.75px`, leaving `10.25px` before the divider.
- The compact `900px` viewport keeps the complete title, quick-open action,
  edit/preview group, project, global comment and send button within the
  horizontal viewport; `scrollWidth` equals `clientWidth`.
- The two filename actions form one fixed `57 × 28px` group. A synthetic long
  filename shrinks to `161px` with ellipsis at the compact viewport while the
  complete action group remains inside its `220px` title row.
- Both tooltip boxes are absolutely positioned and therefore do not change the
  title row or header box. The longer browser tooltip measures about
  `107 × 24px`, remains fully inside the viewport, and starts at `y = 2px`
  rather than clipping against the top edge.
- The focused right-action comparison shows the intentional new bottom
  breathing room while retaining the existing control order, spacing, radii,
  icon scale and visual hierarchy.

Findings:

- No actionable P0, P1 or P2 mismatch remains.
- Fonts and typography: font family, size, weight, line height, wrapping and
  labels are unchanged by this patch. Different source/implementation labels
  come only from the desktop versus browser-preview state.
- Spacing and layout rhythm: header height increases from `76px` to `88px`,
  bottom padding from `8px` to `12px`, and the notification offset consumes
  the same shared height variable.
- Colors and visual tokens: backgrounds, borders, state colors, shadows and
  translucency are unchanged.
- Image and icon fidelity: the existing Phosphor plus icon is retained and the
  matching Phosphor `ArrowSquareOut` icon supplies the requested lower-left to
  upper-right direction; no approximate SVG or image asset was introduced.
- Copy and content: the two tooltips use exactly “打开本地HTML” and
  “在默认浏览器中打开”. In the browser-only preview the latter icon is visibly
  disabled while its explanatory tooltip remains full-contrast.

Comparison history:

1. The source exposed a P1 persistent-header containment failure: the old
   `76px` row left the two-line file metadata and `38px` send button on the
   divider, with visible content/shadows extending below it.
2. The row height, header minimum height and notice offset were unified behind
   `--notice-header-height: 88px`; wide and compact bottom padding became
   `12px`.
3. Post-fix wide and compact measurements show a minimum `10.25px` bottom gap,
   no descendant outside the header, no page-width overflow and no console
   warning or error.
4. The follow-up action cluster preserves the same `88px` header and
   `10.25px` minimum bottom gap. The first tooltip draft touched the viewport
   edge and inherited disabled opacity; moving it down `3px` and scoping
   disabled opacity to the SVG made the hint fully legible without affecting
   layout.
5. User review rejected the dark tooltip surface. The final treatment uses the
   header's near-white surface, a `#e1e2e8` border, muted gray text and a soft
   shadow; geometry and placement remain unchanged.

Interaction checks:

- The header's unique “项目” button opened its panel with
  `aria-expanded="true"` and closed it again with `aria-expanded="false"`.
- The project panel content was visible while expanded.
- Hover-state inspection showed each exact tooltip after its short delay; the
  default-browser action stays unavailable when the desktop preload bridge is
  absent.
- The desktop bridge accepts only a validated known HTML path, converts it to a
  `file:` URL in the main process, and exposes no renderer-controlled URL.
- Browser console warnings and errors: none.

final result: passed

---

## Qoder handoff progress-card redesign

Date: 2026-07-29

Source visual truth:

- User-provided approved flow-panel capture
  (`codex-clipboard-207a9bc1-c4a1-40f8-a453-b1c0a386fd81.png`, local-only).
- The capture was reviewed locally and remains outside the repository.

Implementation evidence:

- `output/design-qa/2026-07-29-handoff-redesign/handoff-waiting-final-1400x900.png`
- `output/design-qa/2026-07-29-handoff-redesign/handoff-waiting-final-1280x720.png`

Combined comparison input:

- `output/design-qa/2026-07-29-handoff-redesign/comparison-reference-vs-final.png`

Viewport and normalization:

- Full-height application viewport: `1400 × 900` CSS pixels. The handoff drawer
  measured `1040 × 760` pixels and the process panel measured
  `504.398 × 489` pixels.
- Compact application viewport: `1280 × 720` CSS pixels. The process panel
  measured `504.398 × 353` pixels.
- The source process-panel crop (`1010 × 977`) and full-height implementation
  process-panel crop (`504 × 489`) were each normalized to `600` pixels wide
  without stretching their heights.
- State: one completed handoff stage, AI stage in progress, validation and
  result pending.

Visible comparison:

- The four cards retain the approved green, indigo and neutral hierarchy with
  numbered circles, stage-specific icon wells, aligned copy and right-edge
  status.
- The validation card uses the approved Phosphor floppy-disk outline, centered
  in the same `40 × 40` icon well as the other stages.
- The active AI card keeps its dashed icon ring and status pill. The bright
  blue outline and dotted text boxes visible in the source are Figma selection
  chrome and are intentionally absent from production.
- The footer divider is removed. The existing actions keep their order and
  button treatment while aligning to the footer top edge, closer to the content.
- Header, summary and body padding were tightened enough to preserve the tall
  card rhythm at the full-height viewport without changing the right-side
  record hierarchy.

Measured checks:

- At `1280 × 720`, all four card rows remain visible at approximately
  `65.95` pixels high.
- Every row's number, icon and status share the same measured vertical center.
- The process panel has no horizontal or vertical overflow.
- The longer validation detail has no text clipping.
- The computed footer top border is `0px`.
- A clean page load produced no browser warnings or errors.

final result: passed

---

## Comment card hierarchy and progressive actions

Date: 2026-07-28

Source visual truth:

- Three user-provided comment-card captures covering visible actions, editing
  hierarchy and the normal-state outer halo. They were reviewed locally and
  remain excluded from the public repository.

Implementation evidence:

- `output/design-qa/2026-07-28-comment-card/comment-card-default-full.png`
- `output/design-qa/2026-07-28-comment-card/comment-card-default.png`
- `output/design-qa/2026-07-28-comment-card/comment-card-hover.png`
- `output/design-qa/2026-07-28-comment-card/comment-card-editing.png`

Combined comparison inputs:

- `output/design-qa/2026-07-28-comment-card/comparison-default-source-vs-production.png`
- `output/design-qa/2026-07-28-comment-card/comparison-hover-source-vs-production.png`
- `output/design-qa/2026-07-28-comment-card/comparison-editing-source-vs-production.png`

Viewport and normalization:

- Production browser viewport and full screenshot: `1280 × 720` CSS pixels at
  1× output density.
- Focused production rail fixture: `376 × 430` CSS pixels; rendered card width
  `348` pixels.
- Source captures: `1486 × 546`, `712 × 542` and `762 × 698` pixels. Their CSS
  viewport and density are unavailable.
- Each focused comparison crops the source and production card regions, then
  normalizes both rail widths to `600` pixels without stretching their heights.
- States: saved comment at rest, actual forced `:hover`, keyboard focus within
  the card, and focused editing.

Full-view comparison evidence:

- The production build was opened at the target viewport and the real PageRoot
  stylesheet was exercised with a temporary synthetic comment-card fixture.
  The fixture used the production markup classes and the same Phosphor icons as
  the application; it was removed after the check.
- The normal card retains the existing right-rail placement, connector,
  typography hierarchy and semantic purple accent while removing the second
  outer ring.
- No page overflow, clipping, broken radius or unexpected surrounding layout
  change appeared in the full capture.

Focused comparison evidence:

- Fonts and typography: saved-comment text and edit text both compute to
  `14px` with `23.1px` line height. Existing target-label and timestamp
  hierarchy remains unchanged.
- Spacing and layout rhythm: the default footer computes to `0px` height and
  `0px` top margin. Hover, keyboard focus and editing reveal a `30px` footer
  with `6px` separation; the card grows by exactly `36px`.
- Colors and tokens: normal, located-focus and editing states each compute to
  one `1px` border, no outline and one
  `0 15px 32px rgb(45 42 104 / 7%)` shadow.
- Editor hierarchy: the focused textarea has a `0px` border, no outline, a
  light-gray tonal background and one `2px` inset purple focus underline.
- Image and icon fidelity: the existing Phosphor paperclip, image, pencil,
  trash, cancel and confirm icons are retained. No replacement asset or
  approximate glyph was introduced.
- Copy and content: production labels, timestamp format and comment content
  remain unchanged; only the approved text size and presentation states move.
- Divider: the footer computes to a `0px` top border in every checked state.

Findings:

- No actionable P0, P1 or P2 mismatch remains.
- The compact reveal is safe for keyboard users: programmatic keyboard focus on
  the card reveals the same `30px` tools while retaining a single card shadow.
- Dense-card placement continues to use the existing `ResizeObserver` height
  measurements, so the additional `36px` revealed height is fed back into the
  established non-overlap layout rather than being reserved at rest.

Comparison history:

1. Source inspection found a P2 hierarchy issue that would have survived a
   base-card-only change: the later `data-focused="true"` rule still added a
   second purple ring and an animated multi-shadow.
2. The composer focus treatment was separated from saved-comment focus.
   Normal, located-focus and editing cards now share one border and one shadow;
   the editor uses a tonal plane and focus underline.
3. Post-fix computed measurements confirmed default footer height `0px`, hover
   and editing footer height `30px`, `6px` reveal spacing, `14px` comment text,
   no divider, no card outline and no second shadow.

Browser checks:

- Production build loaded successfully at the target viewport.
- Default, hover, keyboard-focus and editing states were captured and compared.
- The browser console contained no warnings or errors.

final result: passed

---

# Welcome badge top-right alignment QA

Date: 2026-07-29

Source visual truth:

- `codex-clipboard-bb90f74c-2ac3-4652-b498-dc0d2fd33f92.png` — user-provided temporary reference attachment, `248 × 118` pixels, intentionally excluded from the public repository.
- User direction: preserve the existing badge and the rest of the welcome page, while moving the badge to the upper-right corner of the full hero.
- Scope baseline: commit `9541d13`, the existing PR #52 head before this badge-alignment request. Statements about unchanged surrounding content in this section apply only to the later alignment subchange; the PR's earlier agent-positioning rewrite is documented by the other welcome-page QA evidence.

Implementation evidence:

- `docs/assets/pageroot-welcome-hero.png`
- `output/design-qa/2026-07-29-welcome-badge/desktop-1080x900.png`
- `output/design-qa/2026-07-29-welcome-badge/compact-720x1000.png`
- `output/design-qa/2026-07-29-welcome-badge/badge-region-desktop.png`

Combined comparison input:

- `output/design-qa/2026-07-29-welcome-badge/reference-vs-final.png`

Viewport and state:

- Desktop viewport: `1080 × 900` CSS px; hero region: `1038 × 512` pixels.
- Compact viewport: `720 × 1000` CSS px.
- Source pixels: `248 × 118`; focused implementation pixels: `248 × 118`.
- Both implementation captures used device scale factor 1, so no density normalization was required.
- State: standalone built-in welcome page, default scroll position, fonts loaded.

## Findings

- No actionable P0, P1, or P2 visual issue remains.
- Fonts and typography: the badge retains the existing font size, tracking, weight, and single-line label. No other typography changed.
- Spacing and layout rhythm: on desktop the badge is positioned `44px` from the hero top and `50px` from its right edge. At the compact breakpoint it is `30px` from the top and `24px` from the right. It does not overlap the brand lockup or source card at either viewport.
- Colors and visual tokens: the existing translucent violet surface, white border, muted text, and rounded shape are unchanged.
- Image quality and asset fidelity: the provided reference and final focused region were inspected together. The implemented badge preserves the same visual treatment and renders sharply; no new image or icon asset was introduced.
- Copy and content: relative to the `9541d13` scope baseline, the label remains exactly “内置介绍页” and this alignment subchange does not alter other welcome-page content or visible controls.
- Responsiveness: desktop and compact renders have no horizontal overflow, clipping, or collision.

## Comparison history

1. The baseline placed the badge at the right edge of the hero's left grid column, which left it near the upper middle of the full hero.
2. The badge was moved to be a direct child of the hero and positioned against the hero's upper-right inset. Compact offsets were matched to the existing compact hero padding.
3. Final full-view and focused captures show the badge in the requested corner with the surrounding layout unchanged.

## Browser checks

- Verified the rendered page at `1080 × 900` and `720 × 1000`.
- Confirmed loaded fonts, exact offsets, no element overlap, no horizontal overflow, and no browser console errors.

## Follow-up polish

- None required for this focused alignment change.

final result: passed

---

Viewport: 1280 × 720

References:

- `implementation-v5-composer-tools-1280x720.jpg`
- `implementation-v5-version-panel-1280x720.jpg`

Implementation captures:

- `output/ui-v5-global-composer-1280x720.png`
- `output/ui-v5-version-panel-1280x720.png`

Combined comparison inputs:

- `output/ui-v5-composer-reference-vs-final.png`
- `output/ui-v5-version-reference-vs-final.png`

Visible review:

- The 64 px white header, filename hierarchy, and action order match the approved V5 shell.
- The canvas retains the dominant width while the 376 px comment rail reaches the right application edge.
- Global comment opens directly in the rail; attachment and image controls are visually separated and do not overlap.
- The comment header participates in the same scroll surface as comments, so it does not pin over later cards.
- The project/version panel uses one compact right-side surface, with the history icon placed before the heading.
- Borders, shadows, indigo accents, and warm tones remain restrained; the implementation is slightly whiter than the mock as requested.
- Focus, hover, loading, modal stacking, and reduced-motion behavior remain explicit.
- No broken layout, cropped control, unexpected horizontal overflow, or inconsistent radius was found at the target viewport.
- Content differs intentionally: the implementation capture uses the real PageRoot welcome HTML, while the reference uses the research-page fixture.

## Final status

passed

---

# Welcome page redesign QA

Date: 2026-07-23

Source visual truth:

- User-provided baseline capture, reviewed locally and intentionally excluded from the public repository.

Implementation evidence:

- Desktop top, core-section, workflow-section, and compact captures were reviewed locally and are intentionally excluded from the public repository.

Combined comparison input:

- A side-by-side baseline/final comparison was reviewed locally and is intentionally excluded from the public repository.

Viewport and state:

- Desktop application viewport: `1280 × 720` CSS px at device scale factor 1.
- Desktop canvas iframe viewport: `904 × 656` CSS px; welcome page width `864` px.
- Compact application viewport: `820 × 900` CSS px; canvas iframe viewport `500 × 836` CSS px.
- State: unbound built-in welcome page, edit mode, zero comments, page scrolled to matching regions for focused captures.
- Pixel dimensions: desktop captures `1280 × 720`; compact capture `820 × 900`; combined comparison `2560 × 720`.
- Density normalization: none required; source and final desktop captures use the same CSS viewport and 1× density.

## Findings

- No actionable P0, P1, or P2 visual mismatch remains.
- Fonts and typography: the existing Songti display hierarchy, system sans body copy, weight contrast, and violet accent are preserved. The first implementation produced an awkward headline wrap; the final version uses a semantic two-line break with no orphaned character.
- Spacing and layout rhythm: the hero proportions, 30 px page radius, warm-paper spacing, card radii, and restrained elevation remain aligned with the source visual. The new two-by-two capability grid keeps equal rows and clean dividers.
- Colors and visual tokens: the original warm paper, near-black violet gradient, muted body text, green safety dots, and violet accents are unchanged.
- Image quality and asset fidelity: the supplied PageRoot brand logo remains the only image asset, with the same crop, size, and treatment. No placeholder, generated, or approximate asset was introduced.
- Copy and content: the page now foregrounds smooth native text editing, point-to-target local changes, comments with attachments, and complete validation. The onboarding flow reflects the current explicit “打开最新版” step and the top “项目” entry.
- Responsiveness: the compact canvas switches the hero and four capability cards to one column. Measured horizontal overflow is false at both checked viewports.

## Comparison history

1. Initial implementation review found one P2 typography issue: the accented second half of the hero headline wrapped after its first character.
2. The headline was shortened and the accent span was made a block, producing two balanced semantic lines.
3. Post-fix desktop, core-section, workflow-section, and compact captures show no remaining actionable P0/P1/P2 issue.

## Browser checks

- Primary changed experience tested: welcome page load, iframe rendering, vertical scrolling through all redesigned sections, desktop layout, compact responsive layout, and the top “项目” entry opening and closing the expected project panel.
- Browser console was checked. Reloads surfaced an existing application-level `MutationObserver.observe` error that was already present during the baseline capture; this welcome-page change adds no script and does not alter that runtime path.
- No broken crop, hidden welcome-page content, horizontal overflow, missing logo, or unreadable section was observed.

## Follow-up polish

- None required for this content refresh.

final result: passed

---

# AI handoff four-stage flow QA

Date: 2026-07-28

Source visual truth:

- Three user-provided captures covering the approved process-panel boundary,
  native footer-button treatment, and state-specific actions.
- The source captures were reviewed locally and remain outside the repository.

Implementation evidence:

- `output/design-qa/2026-07-28-ai-flow/handoff-waiting-4-stage.jpg`
- `output/design-qa/2026-07-28-ai-flow/handoff-copy-failure-4-stage.jpg`
- `output/design-qa/2026-07-28-ai-flow/handoff-success-4-stage.jpg`
- `output/design-qa/2026-07-28-ai-flow/handoff-no-change-4-stage.jpg`

Combined comparison inputs:

- `output/design-qa/2026-07-28-ai-flow/comparison-waiting-reference-vs-final.png`
- `output/design-qa/2026-07-28-ai-flow/comparison-process-panel-reference-vs-final.png`

Viewport and state:

- Waiting, copy-failure, and no-change captures: `1152 × 768` screen pixels.
- Success capture: `1336 × 768` screen pixels after the native window zoom
  action; the application content keeps the same desktop breakpoints.
- The waiting-state combined comparison normalizes both source and
  implementation to `1152 × 768` and compares the same locked-processing
  state.
- All states ran in isolated Electron user-data and workspace directories;
  the user's installed application and project records were not used.

## Findings

- No actionable P0, P1, or P2 visual or interaction issue remains.
- Scope: the title area, lock summary, right-side “本轮记录” panel, Finder row,
  modal shell, and existing waiting-state footer remain visually unchanged.
- Progress: seven internal implementation checks are represented as four
  user-facing phases—prepare/copy, wait for AI, validate/save, and result.
- Truthfulness: waiting shows one completed phase and one current phase;
  completion is not inferred from an output file, elapsed time, or a generic
  error.
- State placement: clipboard failure is shown in phase one, no-change ends in
  a neutral result row, and a verified new version ends in the current
  confirmation row.
- Visual hierarchy: each phase is a compact native card using the existing
  green, indigo, neutral, and error tokens. Text remains inside the panel
  without clipping or horizontal overflow.
- Footer actions: the existing waiting buttons retain their original order,
  icons, size, radius, outline, and filled-primary treatment. New actions use
  those same project classes instead of adding a second button design.
- Decision placement: success, no-change, copy recovery, and conflict actions
  belong to the fixed footer; the process cards contain status only.

## Interaction checks

- Created a real frozen Request and confirmed the waiting state shows exactly
  four phases plus the unchanged cancel, preview, and re-copy actions.
- Injected a clipboard write failure and confirmed “重新复制” and “取消本轮”
  are the only footer decisions.
- Ran the official finalizer with changed HTML and confirmed
  “打开最新版” plus “稍后处理”.
- Ran the official finalizer with comparison-identical HTML and confirmed no
  Version was created and the footer offers “修改要求” plus “返回编辑”.
- Checked the accessibility tree in every captured state; phase labels,
  details, counts, and buttons are exposed in reading order.

## Automated checks

- Focused lifecycle, shell, and notification tests: 41 passed.
- Full Node suite: 481 passed, 3 skipped, 0 failed.
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run task:finish`: passed, including 197 Node tests, 8 browser
  smoke tests, 3 Electron smoke tests, and 2 AI closed-loop smoke tests.

## Follow-up polish

- None required inside the approved modification boundary.

final result: passed

---

# Paired review focus and full-bleed canvas QA

Date: 2026-07-23

Source visual truth:

- Three user-provided reference captures, reviewed locally and intentionally excluded from the public repository.

Implementation evidence:

- `output/design-qa/2026-07-23-v52/comment-composer-paired-focus.png`
- `output/design-qa/2026-07-23-v52/comment-marker-paired-focus.png`
- `output/design-qa/2026-07-23-v52/preview-full-bleed.png`
- `output/design-qa/2026-07-23-v52/handoff-no-outer-scroll.png`

Combined comparison inputs:

- `output/design-qa/2026-07-23-v52/comparison-comment-focus.png`
- `output/design-qa/2026-07-23-v52/comparison-preview.png`
- `output/design-qa/2026-07-23-v52/comparison-handoff.png`

Viewport and state:

- Application viewport: `1280 × 720` CSS px at device scale factor 2.
- States checked: seven long global comments, one element-level comment, toolbar comment creation, comment-card focus, canvas “评” marker focus, interactive preview, and waiting-for-Qoder overlay.
- Preview container: `1280 × 644` CSS px with `0` padding, border, and radius; its iframe occupies the full remaining `1280 × 608` CSS px beneath the 36 px preview status bar.
- Waiting panel: `1040 × 624` CSS px; outer drawer and body both have equal client/scroll heights and `overflow: hidden`.

## Findings

- No actionable P0, P1, or P2 visual or interaction mismatch remains.
- Paired focus: opening a comment from the canvas toolbar aligns the composer with the selected canvas heading. In the measured state, the composer began at `168.02` px and the selected target at approximately `163` px.
- Reverse focus: clicking the canvas “评” marker brought both the marker (`146.03–170.03` px) and its matching comment card (`168.03–331.83` px) into the viewport.
- Dense comments: eight comments retained a measured minimum visual gap of `21` px. The focused card is placed first at its target; comments that cannot fit above it are packed below without overlap.
- Focus feedback: the selected card uses a restrained border, soft ring, and short arrival transition; `aria-current="location"` and a polite live-region message expose the same state semantically. Reduced-motion users receive the final state without animation.
- Unified surface: Canvas has no application-shell padding, border, radius, or shadow. The divider between Canvas and comments is removed. Any remaining paper margin belongs to the loaded source HTML and is not rewritten by PageRoot.
- Preview: the preview wrapper and iframe fill Canvas, with no nested application scrollbar.
- Waiting page: the former outer scrollbar is gone. Only the round comment record list scrolls when eight comments exceed its available height.
- Process visibility: all seven steps fit within the timeline panel after compacting each row to 34 px; the final “打开最新版” step remains fully visible.

## Interaction checks

- Opened the global composer seven times and added long comments.
- Opened the element-level composer from the canvas toolbar and confirmed simultaneous target/composer visibility.
- Clicked a lower comment card and confirmed it became the focused, visible card while retaining the shared document scroll.
- Clicked the canvas “评” marker after focusing another comment and confirmed the associated card returned to the target position.
- Entered preview and confirmed the application-level preview frame fills Canvas.
- Sent the mock round to Qoder, confirmed the truthful “已复制至剪贴板” state, and measured no outer drawer scrollbar.

## Automated checks

- `npm run lint`
- `npm run build`
- `npm run gate:edit` — 161 tests passed
- Targeted workbench, notification, and desktop package tests — 27 tests passed
- `git diff --check`

final result: passed

---

# Unified review surface and comment interaction QA

Date: 2026-07-23

Source visual truth:

- Six user-provided reference captures, reviewed locally and intentionally excluded from the public repository.

Implementation evidence:

- `output/design-qa/2026-07-23-v51/main-unified-scroll.png`
- `output/design-qa/2026-07-23-v51/composer-attachments.png`
- `output/design-qa/2026-07-23-v51/comment-edit.png`
- `output/design-qa/2026-07-23-v51/delete-confirm.png`
- `output/design-qa/2026-07-23-v51/dense-comments.png`
- `output/design-qa/2026-07-23-v51/handoff-modal.png`

Combined comparison inputs:

- `output/design-qa/2026-07-23-v51/compare-dense-comments.png`
- `output/design-qa/2026-07-23-v51/compare-comment-controls.png`
- `output/design-qa/2026-07-23-v51/compare-unified-surface.png`
- `output/design-qa/2026-07-23-v51/compare-composer.png`

Viewport and state:

- Application viewport: `1280 × 720` CSS px at device scale factor 1.
- Unified review stage: `1280 × 644` CSS px.
- Canvas editor measured height in the welcome fixture: `1817` CSS px.
- States checked: empty rail, global composer, image plus file attachments, completed comment, comment editing, delete confirmation, three long comments, sent-HTML preview, waiting-for-Qoder overlay, and return-to-waiting.
- Native macOS chrome does not render inside the browser capture. Its `hiddenInset` title bar and traffic-light position `{ x: 18, y: 15 }` were verified by the desktop package contract test.

## Findings

- No actionable P0, P1, or P2 visual or interaction mismatch remains.
- Header: the filename, version, and save state now sit on the lower title-bar row beneath the native macOS controls. The browser-only preview correctly omits fake traffic-light artwork.
- Unified surface: the shell and comment rail share the same cool-white panel token. Only the HTML page, comment cards, composer, and rail header use elevation.
- Scrolling: the document and comments are children of one `.review-scroll-stage`. Measured state shows `overflow-y: auto` on the stage and `overflow-y: visible` on the comment rail; the document body does not become a second application scrollbar.
- Dense comments: three long comments measured `157.45` px tall each and retained `20.55` px visual gaps. Cards never overlap, and their order remains top-to-bottom.
- Composer: selected borders are restrained, the former keyboard-hint copy is absent, the primary action reads “评论”, and attachment/image controls have separated focus rings.
- Attachments: native file chooser events fired for both image and general-file actions. A PNG rendered as a thumbnail and `README.md` rendered as a compact file row beneath the text.
- Editing: activating edit keeps the card in view and exposes a semantic red cancel control plus green confirmation control.
- Destructive action: the trash action opens an in-context “删除这条评论？” confirmation with separate cancel and delete choices; no immediate deletion occurs.
- Processing: sending the welcome-page mock opens a centered `1040 × 624` waiting panel at this viewport, leaving a visible outer margin. Previewing the frozen sent HTML and returning to the waiting panel both work.
- Header send state: after handoff, the button uses the truthful “已复制至剪贴板” state; the integration remains clipboard-only.

## Comparison history

1. The first implementation still let the browser preserve an internal scroll anchor when a composer or tool control changed height, which could move the active card out of view.
2. The review stage disabled automatic scroll anchoring, and composer/edit/delete transitions now explicitly return to their target without scrolling the comment rail independently.
3. The initial full-height canvas override collapsed the editor because it replaced the component height with `auto`; the final rule retains the measured canvas custom property while the outer review stage owns scrolling.
4. Final combined comparisons show the beige shell gap removed, focus borders softened, long comments separated, and the requested controls fully represented.

## Automated checks

- `npm run lint`
- `npm run build`
- `npm run gate:edit` — 161 tests passed
- Targeted workbench, notification, and desktop package tests — 27 tests passed

## Follow-up polish

- None required for this review-surface pass.

final result: passed

---

# Welcome hero copy refinement QA

Date: 2026-07-23

Source visual truth:

- One user-provided reference capture, reviewed locally and intentionally excluded from the public repository.

Implementation evidence:

- `output/ui-v6-hero-copy-1280x720.jpg`
- `output/ui-v6-hero-copy-focus.png`

Combined comparison input:

- `output/ui-v6-hero-reference-vs-final.png`

Viewport and state:

- Desktop application viewport: `1280 × 720` CSS px at device scale factor 1.
- Compact desktop application viewport: `940 × 720` CSS px.
- State: unbound built-in welcome page, edit mode, zero comments.
- Source pixels: `932 × 316`; implementation full-view pixels: `1280 × 720`.
- Focused implementation crop: `930 × 316`, normalized to `932 × 316` only for the combined comparison.

## Findings

- No actionable P0, P1, or P2 issue remains.
- Fonts and typography: the headline now uses a lighter Songti optical weight, tighter display tracking, balanced two-line semantics, and a deliberate second-line inset. Both lines remain readable and unbroken at the desktop and compact desktop viewports.
- Spacing and layout rhythm: the smaller second line and asymmetric inset introduce editorial tension without changing the hero grid, card position, body-copy measure, or surrounding layout.
- Colors and visual tokens: the existing near-black violet surface is preserved; the second line uses a restrained lavender tone with a low-opacity shadow that does not reduce contrast.
- Image quality and asset fidelity: no image asset was changed or introduced. The PageRoot logo and all existing imagery remain untouched.
- Copy and content: the functional slogan was replaced with the more concise pair “所见，即可落笔。 / 所改，止于所选。” It retains the direct-editing and scoped-change meanings while reading as a refined product statement.
- Responsiveness: the title stays on two intentional lines at `1280 × 720` and `940 × 720`. The PageRoot application remains desktop-scoped; the existing narrow-phone shell behavior is outside this focused change.

## Comparison history

1. The supplied reference showed a P2 copy-and-typography issue: the headline was oversized, mechanically aligned, and phrased as a literal feature instruction.
2. The copy was rewritten as two parallel editorial statements; display weight, tracking, line height, accent scale, and second-line alignment were refined.
3. The focused before/after comparison shows improved whitespace, a clearer reading cadence, and no new wrapping or collision issue.

## Browser checks

- Verified the final welcome-page render at desktop and compact desktop widths.
- Confirmed the semantic H1 contains exactly two intended lines and the rest of the welcome page remains unchanged.
- The only captured runtime exception originates from the in-app browser's design-annotation preload `MutationObserver`, not from a PageRoot project script. No PageRoot log error or new error overlay appeared in the independent preview.

## Follow-up polish

- None required for this focused refinement.

final result: passed
