# Design QA

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
