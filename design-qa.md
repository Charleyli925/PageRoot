# Design QA

## 双画布审阅 Demo

Date: 2026-08-01

### Visual truth and evidence

Source visual truth:

- `output/design-qa/ai-review-demo-canvas/source-current-review-1280x720.jpg`
  — 上一版真实复杂 HTML 审阅页，用于核对产品外壳、内容密度、颜色和已有审阅语言。
- `public/review-demo-local/before.html` 与 `public/review-demo-local/after.html`
  — 完整修改前/修改后页面；由本地 fixture 脚本生成并被 Git 忽略，不提交用户 HTML。

Implementation evidence:

- `output/design-qa/ai-review-demo-canvas/07-final-default-overview-1280x720.jpg`
  — 默认整页总览：两个固定桌面宽度的完整 HTML 画布，内容地图收起。
- `output/design-qa/ai-review-demo-canvas/08-final-dashboard-focus-1280x720.jpg`
  — “从宏观指标到微观事件，保持同一条数据叙事”聚焦态，全部差异可见。
- `output/design-qa/ai-review-demo-canvas/03-content-map-open-1280x720.jpg`
  — 右侧内容地图展开态。
- `output/design-qa/ai-review-demo-canvas/06-text-filter-1280x720.jpg`
  — 只看文字与数据变化。
- `output/design-qa/ai-review-demo-canvas/05-structure-filter-1280x720.jpg`
  — 只看结构与顺序变化。
- `output/design-qa/ai-review-demo-canvas/qa-side-by-side-dashboard.jpg`
  — 同一内容段的上一版与本轮实现并排视觉对照。

Viewport and normalization:

- Source and implementation: `1280 × 720` CSS viewport.
- Runtime `devicePixelRatio = 2`; in-app Browser captures normalized to `1280 × 720` output pixels.
- Focused state: change `2 / 7`, difference filter `全部变化`, linked scrolling, fit zoom, content map collapsed.
- The source and implementation were opened together in the same visual comparison input before this pass was accepted.

### Product behavior verified

- Waiting → `模拟 AI 返回` → `审阅修改` enters the complete two-document review.
- Default review opens in `整页总览`; no artificial blur or highlight is applied before the user asks to focus.
- Both panes preserve one fixed `1180px` desktop document width and receive the same scale, so a responsive reflow cannot masquerade as a content change.
- `同步滚动` follows matching semantic anchors rather than raw scroll percentage. Scrolling the original moved both documents through the corresponding content region.
- `独立滚动` keeps the other pane still. Switching back to linked mode aligns it to the last active pane's semantic position.
- Holding Option/Alt temporarily allows independent scrolling while linked mode stays selected.
- `适应` and `100%` both work; at 100% both iframe document bounds measured `1180px` wide.
- Clicking a content-map item positions both documents at the matching user-facing section, dims unrelated modules, and highlights the relevant targets.
- `全部变化`, `文字与数据`, `结构与顺序`, and `视觉样式` alter the visible evidence without changing the selected content section.
- Previous/next navigation traverses the seven changes. `查看整页` removes all review classes from both documents.
- The collapsed map is removed from keyboard focus with `inert`, `aria-hidden`, `visibility`, and disabled pointer events; hover peeks it and pinning keeps it open.
- `接受全部并打开` reaches `已打开 AI 版本 V1.4`; `保留当前版本` reaches `已保留当前版本 V1.3`.

### Fidelity review

No actionable P0, P1, or P2 finding remains.

- Typography: product-shell labels remain legible at the tested viewport; source HTML typography is rendered directly inside both iframes rather than recreated.
- Spacing and layout: the review body is devoted to two equal canvases. The overlay map no longer reserves permanent width, and the toolbar remains one compact row.
- Color and semantics: red marks removed/original evidence, green marks added/current evidence, purple dashed outlines mark structure, and blue marks visual styling. Labels and filter names provide non-color cues.
- Content clarity: map entries use visible HTML headings and content phrases, not implementation terms such as “Hero” or “Dashboard”.
- Asset quality: the two complete HTML files and their original assets are rendered directly; no replacement screenshot, custom SVG, emoji, placeholder illustration, or CSS drawing was introduced.
- Interaction clarity: page-section focus, difference type, scrolling mode, and zoom are independent controls, so the user can answer one comparison question at a time.
- Accessibility: icon controls have accessible names, toggles expose pressed/expanded state, iframes have version-aware titles, and hidden overlay content is inert.
- Motion: transitions are brief and respect `prefers-reduced-motion`.

### Comparison history

1. P1 — the first linked-navigation pass could land near the media section because initial iframe scrolling triggered a feedback loop. Both-frame navigation now acquires the synchronization lock and uses immediate anchor positioning. Post-fix evidence: `02-canvas-overview-fixed-1280x720.jpg`, `07-final-default-overview-1280x720.jpg`, and `08-final-dashboard-focus-1280x720.jpg`.
2. P2 — the visually hidden map could still receive keyboard focus. The closed drawer now applies `inert`, `aria-hidden`, `visibility: hidden`, and pointer-event blocking. A browser check confirmed the attributes in the collapsed state.
3. P2 — early toolbar and vertical-handle labels were too small at the final viewport. Their type sizes and contrast were increased; the final overview and focused captures show the corrected hierarchy.
4. Post-fix visual comparison and interaction checks found no remaining P0/P1/P2 issue.

### Console and tooling note

- No product interaction failed during the verified journey.
- The in-app semantic browser reports one source-less `MutationObserver.observe` type error before Vite connects when the review route contains nested same-origin iframes. It does not reproduce on the app root or either standalone HTML file, has no application URL or stack, and does not recur after Vite connection. This is recorded as an instrumentation limitation rather than a product-console failure.

### Follow-up polish

- P3: a later iteration can add movement connectors or a short “before → after” structure replay for very large module moves.
- P3: production should serve untrusted user HTML from a dedicated isolated origin.

final result: passed
