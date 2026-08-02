# Design QA

> Historical 2026-08-01 baseline. The 2026-08-02 pass below supersedes its slider range, toolbar, clause-diff, and scroll-sync observations.

## 双画布审阅降噪与内容地图交互

Date: 2026-08-01

### Visual truth and evidence

Source visual truth:

- `codex-clipboard-f24bb5f5-e036-499c-b75c-b18b2f657956.png` — 双画布标签相互遮挡的主要问题证据。
- `codex-clipboard-50f2dcca-2617-43d1-adb4-962c9a8baad8.png` — 过高、白色且 hover 会整体展开的内容地图把手。
- `codex-clipboard-7410309b-ccf7-4c1d-8923-f7093caf49e4.png` — 用户指定的蒙层透明度控件位置。
- 其余用户截图用于核对伪元素圆形、实色差异底色、“新增视觉样式”与结构标签遮字等具体症状。

Implementation evidence:

- `output/design-qa/ai-review-demo-polish/13-final-desktop-opening-1280x720.png` — 最终桌面聚焦态，内容地图收起。
- `output/design-qa/ai-review-demo-polish/08-content-map-open-aligned-1280x720.png` — 用户主动打开内容地图后的展开态。
- `output/design-qa/ai-review-demo-polish/10-tablet-dashboard-stable-1024x768.png` — 窄桌面的第 2 处变化与稳定双画布定位。
- `output/design-qa/ai-review-demo-polish/12-mobile-390x844.png` — 移动宽度下改为上下画布，控件仍可用。
- `output/design-qa/ai-review-demo-polish/14-reference-vs-implementation.png` — 主问题截图与最终实现的同一比较输入。
- `output/design-qa/ai-review-demo-polish/15-rail-reference-vs-implementation.png` — 内容地图把手的同区域对照。

Viewport and normalization:

- Primary implementation viewport: `1280 × 720` CSS pixels.
- Responsive passes: `1024 × 768`, `768 × 900`, and `390 × 844`.
- The source material consists of issue crops rather than a canonical full-screen mock. The comparison boards therefore normalize the relevant review state and crop height instead of claiming pixel-for-pixel page fidelity.
- Reference and implementation were inspected together in the combined comparison inputs before this pass was accepted.

### Product behavior verified

- Waiting → `模拟 AI 返回` → `审阅修改` enters the complete two-document review.
- The collapsed content-map rail is compact and translucent purple. Hovering the rail body no longer opens the drawer; the named `内容地图` button pins it, while a dedicated 4px far-right edge trigger supports peek-open.
- Previous/next buttons remain available while the map is closed. Moving from change 1 to change 2 left the map button at `aria-expanded="false"` and positioned both documents at the dashboard evidence.
- Programmatic positioning and user-led linked scrolling are isolated. Change navigation remained at the dashboard after a 3-second stability wait and after resizing from 1280px to 1024px; no feedback loop drifted to a later section.
- The `蒙层透明度` range updates both frames. At 90%, the output read `90%`, context opacity was `.58`, and focus-mask opacity was `.10`; it was restored to the 72% default for handoff.
- Each active section contains one real `.pageroot-focus-mask`; the previous active-section `::after` injection is absent, so source pseudo-elements keep their own geometry and the unintended giant circle is gone.
- Default label visibility measured zero in both frames while all 12 review labels remained available for hover/focus reveal. Labels on the same target merge into one `·`-separated line and ancestor labels yield to the innermost hovered diff.
- Removed and added text use thin red/green line boxes; the red strike-through and green underline remain. Structure and visual-style changes use outline/edge treatments without replacing the target's real background.
- At 390px the two canvases stack vertically, the toolbar condenses to icons, the transparency slider remains reachable, and no visible horizontal page overflow or label collision appears.

### Fidelity review

No actionable P0, P1, or P2 finding remains.

- Typography: difference labels are reduced to 10.5px, background-free, hidden at rest, and no longer cover HTML copy.
- Spacing and layout: the rail's active footprint is materially shorter; internal gaps and blank space are reduced while its navigation buttons retain practical hit areas.
- Color and surfaces: purple translucency distinguishes the map affordance without creating an opaque slab. Semantic red, green, purple, and blue evidence is expressed primarily through lines rather than solid fills.
- Content visibility: the default 72% mask preserves enough surrounding-page context to orient the user, and the slider allows a 40–95% range.
- Interaction clarity: opening the content map, traversing changes, choosing a diff filter, changing zoom/scroll behavior, and tuning mask transparency remain separate controls.
- Accessibility: the slider has an explicit accessible name and live numeric output; map and filter buttons expose expanded/pressed state; hidden labels are `aria-hidden`; reduced-motion handling is retained.
- Assets and source fidelity: the original HTML and its assets render directly inside both frames. No replacement illustration, SVG approximation, emoji, or placeholder asset was introduced.

### Comparison history

1. P1 — the injected review `::after` inherited the source hero pseudo-element's 460px circular geometry. Replacing it with a dedicated child mask removed the unexplained circle without changing the source design.
2. P1 — linked scroll events could bounce between the two frames after next/previous navigation and eventually drift to the media section. Programmatic scroll suppression plus a single wheel-designated leader frame removed the feedback loop.
3. P2 — solid red/green fills and solid structure/style surfaces obscured the HTML being reviewed. These are now line-only treatments that preserve original backgrounds and text colors.
4. P2 — stacked badges covered headings, rows, and cards. Labels are now hidden at rest, merged per target, and reveal only for the relevant hovered/focused diff.
5. P2 — the entire rail opened on hover and blocked its own navigation. Drawer opening is now limited to the explicit map button or the far-right edge strip.
6. Post-fix combined visual comparison, desktop interaction checks, slider verification, navigation stability checks, and responsive captures found no remaining P0/P1/P2 issue.

final result: passed

---


# AI review demo design QA

Date: 2026-08-02

## Source comparisons

- Text diff reference vs. implementation: `output/design-qa/ai-review-demo-v2/comparison-text-before-after.png`
  - The implementation keeps the real HTML background and typography visible.
  - Changed clauses receive a red or green outline; character-level deletion and addition evidence remains a strike-through or underline.
  - Persistent text badges and solid annotation fills no longer cover the document.
- Pane header reference vs. implementation: `output/design-qa/ai-review-demo-v2/comparison-toolbar-before-after.png`
  - The duplicated per-pane header row is removed.
  - Version identity and full-page links now live in the review toolbar.
- Bottom-scroll reference vs. implementation: `output/design-qa/ai-review-demo-v2/comparison-scroll-before-after.png`
  - Both documents align at their true bottom boundary.
  - Continuing to scroll the leader pane at the bottom does not move the other pane to an earlier semantic anchor.

## Browser checks

- 1280 × 720: overview, text diff, structure diff, style diff, sparse all-changes mode, content-map navigation, and bottom scroll alignment checked.
- 960 × 720: compact toolbar and dual-canvas layout checked; controls remain reachable and the review rail stays independent from previous/next buttons.
- Context visibility range verified at 0, 72, and 100; default is 72.
- The initial overview consistently opens at the top of both documents.
- A development-runtime `MutationObserver` error occurs on the initial route before entering review; opening and using the review canvas introduces no additional browser errors.

final result: passed

---

# AI review demo design QA · v3

Date: 2026-08-02

## Source visual truth

- `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-d03405b0-5582-41dc-a5da-9e5af953b962.png` (`2552 × 790`) — 删除线、红/绿/蓝差异框和底部强调线的问题证据。
- `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-a2a22a53-f155-4f2b-80ef-e092a04df898.png` (`2808 × 1084`) — 上下文可见度和“全部变化”状态。
- `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-a84dd663-1c3b-4e72-9102-846fa7fa223e.png` (`634 × 544`) — 内容地图顶部介绍卡的删除目标。
- `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-3d722624-197a-494f-a1b4-341b7b33723f.png` (`2920 × 174`) 与 `/var/folders/jx/w52403cs2hx39vwhd1sb3tg80000gn/T/codex-clipboard-cf3d3544-24b3-4f1d-888b-82b66528e8fb.png` (`362 × 150`) — 可收起工具条和默认 `100%` 缩放目标。

## Rendered implementation evidence

- `output/design-qa/ai-review-demo-v3/all-changes-1280x720.png` — 两栏“全部变化”主状态。
- `output/design-qa/ai-review-demo-v3/content-map-1280x720.png` — 内容地图打开状态。
- `output/design-qa/ai-review-demo-v3/comparison-markers.png` — 差异标记全视图同屏对比。
- `output/design-qa/ai-review-demo-v3/comparison-controls.png` — 工具条、上下文可见度和画布的全视图同屏对比。
- `output/design-qa/ai-review-demo-v3/comparison-map.png` — 内容地图的同屏对比。
- `output/design-qa/ai-review-demo-v3/comparison-controls-focused.png` — 收起把手和 `100%` 选中态的局部对比。

Viewport and normalization:

- Browser viewport and CSS viewport: `1280 × 720`; implementation screenshot: `1280 × 720`; device scale factor normalized to `1`.
- Source images are issue-specific crops rather than a single canonical mock. Comparison boards retain each source crop's aspect ratio, resize with `contain`, and pair it with the matching implementation state; no pixel-perfect full-page claim is made.
- State: review mode, opening section, `全部变化`, context visibility `22%`, linked scrolling, actual-size `100%`, toolbar pinned open. The map comparison additionally pins the content-map drawer.

## Findings

No actionable P0, P1, or P2 finding remains.

- Typography: reviewed HTML typography remains unchanged; labels stay hidden at rest and no longer add a persistent baseline under added content. Removed text retains a dashed strike-through.
- Spacing and layout rhythm: removing the map intro card lets the list begin directly with `页面开头`. The toolbar opens and closes only from its handle, so hover cannot trap it open.
- Colors and visual tokens: red, green, gray, purple, and blue review evidence is outline-only. Computed evidence reports a `2px dashed` outline and `box-shadow: none`; changed elements keep their real fill and border appearance.
- Image and asset fidelity: both original local HTML documents and their native assets render directly in the frames; no assets were replaced or approximated.
- Copy and content: `按页面里的内容整理` and its helper text are absent. The remaining map section names and seven change summaries match the page content.
- Accessibility: canvas scroll regions are keyboard focusable and named; filter, zoom, map, toolbar, and linked-scroll controls expose pressed/expanded states.

## Browser interaction checks

- Fresh load → `模拟 AI 返回` → `审阅修改` opened both documents at horizontal position `0` with `22%` and `100%` selected.
- `全部变化` produced visible evidence instead of an empty canvas: before side `21` tokens, `19` clauses, `8` structure marks; after side `14` tokens, `12` clauses, `7` structure marks, and `1` style mark.
- Computed style checks: removed text is `line-through` with `text-decoration-style: dashed`; added text has `text-decoration-line: none`; representative review frames are `2px dashed` with no shadow/accent line.
- The review toolbar was collapsed and reopened successfully in the same session.
- At `100%`, scrolling the left canvas horizontally synchronized both sides to the same `511.5 / 557` position.
- The content map opened by its explicit control, and its accessibility snapshot contained no `按页面里的内容整理` text.
- Responsive evidence from the preceding pass at `960 × 720` remains applicable; this pass changed marker grammar and scroll behavior without changing the responsive grid.
- Console checked. The long-lived development browser log contains the previously documented dev-runtime `MutationObserver` error during route initialization; this review session added no feature-specific error and all tested controls remained operational.

## Comparison history

1. The first evidence capture reused the automation tab's prior scroll position and therefore did not represent a fresh product state. It was rejected as invalid comparison input, the page was hard-reloaded, and all final evidence was recaptured from top-left at `100%`.
2. Post-normalization full-view comparison confirmed that all difference categories are simultaneously visible, use dashed frame-only treatment, and preserve the underlying HTML.
3. Focused comparisons confirmed the removed map intro, deterministic toolbar toggle, `22%` default, and selected `100%` zoom. No subsequent visual fix was required.

final result: passed
