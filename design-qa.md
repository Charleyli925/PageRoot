# Design QA

## AI review workspace — final seven-state contract

Date: 2026-08-03

### Comparison target

- Source visual truth: `/tmp/review-toolbar-unified-v3.png`
- Rendered implementation: `output/design-qa/ai-review-final.png`
- Additional rendered state: `output/design-qa/ai-review-map.png`
- Full combined comparison: `output/design-qa/comparison-full.png`
- Focused toolbar comparison: `output/design-qa/comparison-toolbar.png`

The source board establishes the accepted visual language: one quiet white
review surface, neutral gray segmented controls, one violet selected state,
compact labels and a centered retractable handle. The later product decision
supersedes two information-architecture details visible in that board:

1. the two version cards are removed and replaced by one `整页 / 左页 / 右页`
   page-preview group;
2. the former mixed review group is separated into `页面预览` and
   `变化审阅（全部变化 / 文案 / 结构 / 视觉）`, while both groups retain the
   same segmented-control treatment.

The implementation is judged against that later contract, not against the
superseded card content.

### Viewport, pixels and density normalization

- Source board: `1720 × 402` physical pixels.
- Electron implementation: `2880 × 1920` physical pixels from a
  `1440 × 960` CSS-pixel window at Retina `2×` density.
- Primary state: light theme, toolbar pinned, `整页` selected, context `22%`,
  synchronized scrolling selected, zoom `100%`, content map closed.
- Additional state: the same viewport and controls with the complete content
  map pinned open.
- Full comparison normalization: the implementation's top `2880 × 620`
  physical-pixel crop is Lanczos-downsampled to `1720 × 370` and vertically
  combined with the source board at its native `1720 × 402` size.
- Focused comparison normalization: source toolbar crop `1592 × 120`
  (`x=64, y=218`) is combined with implementation toolbar crop `2824 × 224`
  (`x=28, y=190`) downsampled to `1592 × 126`.
- The source says `7 处变化` and the deterministic Electron fixture says
  `4 处变化`; these are dynamic document facts and are not treated as visual
  drift.

### Full-view and focused evidence

- The full comparison confirms the formal PageRoot header, review surface,
  centered retractable handle and dual-page canvas form one clear vertical
  hierarchy. The pinned toolbar ends before the version headers begin, so it
  no longer covers either page caption.
- The focused comparison makes every persistent toolbar label readable. All
  seven review states share the same height, radius, gray resting surface,
  violet active color and white selected tile.
- The explicit `整页` button is the selected entry state. `左页` and `右页`
  sit in the same group, while the four change modes form a distinct but
  visually identical group. This is the final requested hierarchy.
- The map-state screenshot confirms that the drawer remains attached to the
  right edge, preserves the full-height page canvas, shows unchanged as well
  as changed regions and does not collide with the pinned review toolbar.

### Required fidelity surfaces

- Fonts and typography: the implementation uses the product's system stack
  (`-apple-system`, `SF Pro Display`, `Segoe UI`) and follows the source's
  compact optical hierarchy. Labels, active weights, metadata and percentages
  remain single-line and legible without truncating a core mode name.
- Spacing and layout rhythm: toolbar padding, 38 px segmented shells, 32 px
  selected tiles, 10 px control labels, 15 px outer radius, quiet elevation
  and the centered handle reproduce the source's density. Grid tracks were
  rebalanced so the four-item change group receives enough width.
- Colors and visual tokens: neutral `#f1f1f5` controls, white active tiles,
  gray metadata and the single violet family (`#6258d6` / `#4f47b8`) preserve
  the source's one-emphasis-color rule. Before/after identity uses only a quiet
  neutral dot and a violet dot; red/green comparison surfaces are absent.
- Image quality and asset fidelity: the target contains no photographic or
  illustrative asset. All visible interface icons use the existing Phosphor
  icon package and the product's HTML file icon treatment; no emoji,
  handcrafted SVG, CSS drawing or placeholder image replaces a source asset.
- Copy and content: persistent copy matches the frozen contract — `页面预览`,
  `整页`, `左页`, `右页`, `变化审阅`, `全部变化`, `文案`, `结构`, `视觉`,
  `上下文可见度`, `滚动方式` and `画布缩放`. The formal header actions are
  `返回 AI 修改前` and `接受全部并打开`.
- Icons and controls: icon weight and 12–20 px sizing are consistent with the
  existing workbench. Selected, resting, disabled, focus-visible and pinned
  states remain distinguishable.
- Accessibility and resilience: both segmented groups support arrow keys plus
  Home/End, every state exposes `aria-pressed`, the confirmation dialog traps
  focus and restores it to its trigger, reduced motion removes toolbar/drawer
  transitions, and the tested `1440 px` and constrained `1180/980 px` grids do
  not hide persistent mode labels.

### Findings and comparison history

1. Initial comparison — `[P2]` the pinned toolbar overlaid both page-version
   headers. Fix: the pinned state now reserves `118px` above the canvas grid,
   uses border-box sizing and disables that transition under reduced motion.
2. Initial comparison — `[P2]` the last item in the four-mode change group
   could clip because the context slider owned too much grid width. Fix: grid
   tracks were reordered and rebalanced at the base, `1180px` and `980px`
   layouts, then the implementation was recaptured.
3. Post-fix focused comparison — `整页`, all four change labels, sync controls
   and `100%` are fully readable; no overlap, clipping or inconsistent selected
   surface remains.
4. Post-fix full comparison — the official header, toolbar, dual-page headers,
   page canvas and optional content map retain clear boundaries at the same
   Electron viewport.

No actionable P0, P1 or P2 finding remains. The source's version cards and
single mixed mode row are intentionally superseded by the user's later,
explicit seven-state hierarchy.

### Interaction and automated evidence

- Default entry is a clean dual-page `整页` preview; `左页` and `右页` each
  render one page, and the explicit `整页` action restores the dual-page view.
- Any change mode restores the dual-page canvas and focuses the first matching
  change. Empty modes expose a status message instead of leaving stale marks.
- All-change overview uses sparse outer dashed regions. Text mode uses
  sentence groups plus precise insert/remove markers, structure mode detects
  pure movement, and visual mode uses violet-blue dashed presentation marks.
- The complete map reveals an authored hidden Tab before focusing its region.
- Linked horizontal scrolling mirrors pixel position; linked vertical
  scrolling aligns by outline-region ID and relative progress rather than raw
  page offset.
- Both return and accept paths require confirmation; the accept path activates
  the verified candidate only after explicit confirmation.
- The real Electron closed-loop suite passes both AI review/acceptance and
  broad-related-result scenarios with the source file unchanged until accept.

### Implementation checklist

- [x] Shared official workbench header.
- [x] One mutually exclusive seven-state model rendered as two control groups.
- [x] Explicit whole-page return from either single-page view.
- [x] Sparse, mode-specific diff presentation.
- [x] Complete map, hidden-panel reveal and semantic scroll synchronization.
- [x] Keyboard, focus-dialog and reduced-motion behavior.
- [x] Same-state full and focused visual comparison after P2 fixes.

final result: passed

---

## Comment, safe page-switching and update-header polish

Date: 2026-07-31

Source visual truth:

- User-provided local captures (not committed) showed a focused comment hidden
  by the sticky header, a page-switch action that must preserve scroll, and the
  required whole-page-first comment order.
- Additional local captures established the existing HTML identity control,
  available header space and centered no-update geometry.
- Two real-report captures established the supported `data-p` and
  constant-index `onclick` Tab patterns; another showed that dense comments
  must stop at the authored page bottom rather than stretching the review
  stage.

Implementation evidence:

- `output/design-qa/comment-presentation-header-polish/no-update.png`
- `output/design-qa/comment-presentation-header-polish/new-update.png`
- `output/design-qa/comment-presentation-header-polish/restart-update.png`
- `output/design-qa/comment-presentation-header-polish/header-geometry.json`
- `tests/e2e/browser/native-dom-comment-tabs.spec.mjs`
- `tests/e2e/browser/native-dom-presentation-actions.spec.mjs`
- `tests/e2e/electron/ai-handoff-closed-loop.spec.mjs`

Viewport, density and state:

- Header captures come from the real Electron renderer at a `1440px` CSS
  viewport. Each screenshot clips the top-left `900 × 88` CSS-pixel region
  and is saved at Retina 2× density as `1800 × 176` pixels.
- `no-update.png` captures the normal identity control before update state is
  injected. `new-update.png` uses the real update-available IPC state. The
  downloaded state dismisses the normal restart confirmation with “稍后” before
  `restart-update.png` is captured, so the header is evaluated without a
  modal overlay.
- The browser interaction oracle runs at `1600 × 900` CSS pixels with normal
  mouse, keyboard, textarea and scroll input.

Full-view and focused comparison evidence:

- The HTML icon remains `34 × 34px` inside a fixed `60 × 42px` interaction
  cluster and uses the cluster's exact vertical center in all three states.
  Both update labels are absolutely positioned in the lower part of that same
  cluster, producing the attached badge treatment without changing icon,
  cluster or neighboring title geometry.
- The cluster, icon and two-line title/metainfo block all share the exact
  `y=53.875` center. The icon remains at `y=36.875…70.875` in the no-update,
  available and downloaded captures. The visible update text ends at
  `y=75.375`, leaving `12.625px` above the `88px` header boundary.
- The longer visible label ends at `x=82.992`; the title/metainfo column begins
  at `x=92`, retaining a measured `9.008px` gap. The compact `New!` label has
  substantially more space. Neither label touches the title, metadata, plus
  action or open-in-folder action.
- Clicking the HTML icon opens the existing About dialog; the icon remains a
  single accessible button, and its update child action has its own accessible
  label.

Behavioral evidence:

- Opening a new comment requests focus after the composer mounts. Enter saves;
  Shift+Enter inserts a newline; IME composition never submits. The same
  keyboard contract applies when editing a saved comment.
- A selected comment is aligned no higher than the sticky header's measured
  safe bottom. Whole-page comments use an explicit leading scope rank, while
  all other page-position ordering remains stable.
- The Canvas natural height owns the rail bottom. A dense queue is vertically
  clipped rather than increasing shared-page height; after the page reaches its
  bottom, continued downward wheel input translates later cards into view and
  reverse input restores the natural queue.
- During native text editing, visible comment targets retain their last stable
  top and height. Runtime text reflow therefore cannot make adjacent cards
  jump, while the next settled layout can still refresh normally.
- Page-presentation switching captures the shared Canvas scroll position and
  restores it after the presentation mutation. The old unconditional
  “presentation became ready” reveal is removed; explicit user navigation still
  reveals its intended target.
- The legacy page switchers are deliberately narrow: either one uniform
  `data-p` / `data-tab` control group with unique panel IDs, or one sibling
  control group with the same exact constant-index handler and one uniquely
  related uniform panel group. Both require a single matching active pair and
  permit only disposable `active` class changes. Authored scripts are never
  executed and source bytes are never written.
- The supplied `26Q2搜索市场概览(1).html` resolves three safe controls, exposes
  “切换到此页签” for `p2`, changes only the isolated rendered presentation and
  leaves the source unchanged. Ambiguous, mixed, duplicate and multi-active
  fixtures fail closed.
- The newly supplied four-Tab report resolves the exact
  `switchChart(0…3)` sequence to four controls. Selecting its second control
  proposes one `activate-tab` action with exactly four disposable class
  transitions; no source write or handler execution is involved. Duplicate,
  skipped, mixed, compound, multi-active and multi-panel-candidate variants
  remain inert.

Findings:

- No actionable P0, P1 or P2 visual or interaction defect remains in this
  scope.
- The update label is intentionally small and attached to the HTML icon. It
  stays readable in both states without displacing or obscuring any neighboring
  header element.
- The comment and page-switching changes are presentation-only. They do not
  reorder persisted comments, execute authored page scripts, or modify source
  bytes.

Interaction and regression history:

1. Pure helpers established the sticky-header clamp, whole-page-first rank,
   text-edit geometry freeze and keyboard submission contract.
2. Browser tests exercised real focus, Enter/Shift+Enter, saved-comment edit,
   native content reflow, queue ordering and preserved scroll.
3. Electron tests injected both real update states, opened About through the
   HTML icon, measured all header rectangles and captured the final images.
4. The final visual comparison found no clipping, overlap, header overflow or
   unintended spacing change; no subsequent P0/P1/P2 repair was required.
5. The complete task gate passed: architecture, TypeScript, lint, 310 Node
   assertions, production web build, 10 browser smoke tests, real-HTML
   authority, desktop build, 6 Electron smoke tests and 2 AI closed-loop
   tests. The report is
   `output/test-runs/2026-07-31T05-05-54-402Z-task/results.json`.

final result: passed

---

## About dialog simplification

Date: 2026-07-30

Source visual truth:

- User-provided local reference image (not committed).
- User direction: remove the four red-marked regions—“PageRoot for macOS”,
  “Apache-2.0”, the complete usage-data notice, and the update-channel
  eyebrow—then realign the remaining content into a balanced compact dialog.

Implementation evidence:

- `output/about-dialog-after.png`
- `output/about-dialog-comparison.png`
- `output/about-dialog-focused-comparison.png`

Viewport and normalization:

- Source and implementation full captures are both `1252 × 1128` pixels.
- Implementation browser viewport: `1252 × 1128` CSS pixels at 1× density.
- The source dialog is a Retina-style capture. For the authoritative focused
  comparison, its `1160 × 1078` dialog crop is downsampled to `580 × 539`.
  The implementation dialog is compared at its native `580 × 388` CSS-pixel
  size, aligned at the same normalized width.
- State: current stable application version, Apple silicon, About dialog open.

Full-view and focused comparison evidence:

- All four requested regions are absent from the rendered dialog; a bounded
  text check also confirms no hidden residual copy remains.
- The remaining identity, metadata, update, GitHub, and footer surfaces share
  the same `518px` left/right content baseline.
- The dialog measures `580 × 388px` and does not scroll. Removing the long
  notice therefore reduces height without leaving a blank middle region.
- Vertical rhythm is compact and regular: identity to metadata `18px`,
  metadata to update card `20px`, update card to GitHub card `12px`, and
  GitHub card to footer `15px`.
- The update title now becomes the first text line beside its icon, preserving
  the status hierarchy after the eyebrow is removed.

Findings:

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: the established family, weights, sizes, line heights,
  truncation behavior, and Chinese hierarchy remain unchanged; only the
  explicitly removed eyebrow text is gone.
- Spacing and layout rhythm: the dialog is centered, all major sections use
  the same horizontal baseline, and the reduced height has no dead space,
  clipping, overlap, or scrollbar.
- Colors and visual tokens: the existing white/indigo identity surface, green
  current-version card, borders, radii, blur, and shadows remain intact.
- Image and icon fidelity: the supplied PageRoot logo and existing Phosphor
  icons are unchanged and remain sharp at their intended sizes.
- Copy and content: exactly the four marked content groups are removed. Version,
  architecture, update state, GitHub description, and disclaimer entry remain.

Comparison history:

1. The source contained four user-marked regions that lengthened the dialog
   and diluted the primary product/update hierarchy.
2. The first implementation removed those regions and tightened metadata and
   update-card margins.
3. Post-fix rendering confirmed a `580 × 388px` non-scrolling dialog, aligned
   `518px` content tracks, no residual marked copy, and no page or console
   errors. No subsequent P0/P1/P2 fix was required.

Interaction checks:

- The unique close button closes the dialog and the local desktop-state fixture
  reopens it successfully.
- The current-version action remains enabled and visually aligned.
- Page errors: none.
- Browser console warnings and errors: none.

final result: passed

---

## Fixed comment geometry, queue alignment and recoverable edits

Date: 2026-07-31

Source visual truth:

- Three user-provided local captures (not committed) established the original
  Canvas/comment-rail composition, the stronger selected-card boundary and the
  recovery state for a changed but unconfirmed saved-comment edit.
- The approved external interaction fixture (not committed) supplies the
  queue-translation and wheel-handoff oracle.

Implementation evidence:

- `tests/e2e/browser/native-dom-comment-tabs.spec.mjs` covers clean/dirty edit
  switching, exact draft resumption, stable hover geometry, selected boundary,
  Canvas framing, unchanged DOM order, aligned queue offset and wheel routing.
- `tests/comment-rail-layout.test.mjs` covers deterministic queue layout,
  aligned offset, page-first wheel routing and page-top rail restoration.
- The approved fixture's live 1280 × 720 comparison was rechecked beside the
  original PageRoot capture after the hint removal and fixed-height update.

Required fidelity surfaces:

- Card geometry: the 30px action row plus 6px gap is reserved in default,
  hover, selected and edit states. Only opacity and pointer availability
  change, so ResizeObserver does not move neighboring cards on pointer entry.
- Focus boundary: the selected card keeps one physical boundary, strengthens
  it to `#8f8ae8`, and adds the `#5e58d9` leading emphasis without a second
  outer halo or a width-changing state transition.
- Queue behavior: natural `top` values and DOM order remain source-position
  based. Explicit card/draft navigation changes one shared CSS translation;
  target and selected card settle within 3px in the browser oracle.
- Wheel behavior: input over the right rail changes the shared review stage.
  Upward input restores a negative rail offset only after the stage reaches
  its top; down and non-top movement retain page priority.
- Edit transaction: text and attachment changes stay outside the saved
  `CommentItem` until confirmation. A clean edit cancels when its target leaves
  the active Tab; a dirty edit persists one local recovery record and resumes
  at the original framed target from “有一条未保存修改”.
- Copy: no “向上滑动找回隐藏评论” hint is introduced in production or the
  approved fixture.

Interaction checks:

- Existing current/other-Tab draft route suite: passed.
- New clean/dirty saved-edit Tab suite: passed.
- New fixed-height, selected alignment, order and wheel suite: passed.
- Pure rail helper suite: 10/10 passed.
- TypeScript and architecture contract: passed.
- Full task gate: passed (430 Node assertions, browser smoke, real-HTML
  discovery, Electron smoke and AI closed-loop smoke; no failures).
- Browser console/page errors in the covered flows: none.

Findings:

- No actionable P0, P1 or P2 mismatch remains in this scope.
- The queue translation is deliberately presentation-only; it never changes
  source anchors, comment identity, timestamps or persistence order.

final result: passed

---

## Unsaved comment routing and stable rail order

Date: 2026-07-30

Source visual truth:

- Three approved generated references (not committed) define the current-Tab
  header hierarchy, other-Tab expansion with neutral cards and the resumed
  composer styling.
- Final user annotations supersede two details in those images: a hidden-Tab
  draft has no duplicate “有一条未保存评论” shortcut, and every saved card,
  collapsed draft and composer follows page-position order rather than giving
  the composer priority.

Implementation evidence:

- `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-draft-recovery.png`
- `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-other-tab-draft.png`
- `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-hidden-draft-resumed.png`

Combined comparison inputs:

- `output/design-qa/2026-07-30-comment-draft-routing/comparison-current-draft.png`
- `output/design-qa/2026-07-30-comment-draft-routing/comparison-other-tab-draft.png`
- `output/design-qa/2026-07-30-comment-draft-routing/comparison-resumed-composer.png`

Viewport and normalization:

- Implementation viewport: `1600 × 900` CSS pixels at 1× density; the visible
  comment rail crop is `376 × 812` pixels from below the application header.
- Source images: `906 × 1736`, `940 × 1672` and `906 × 1736` pixels. Each
  source rail was proportionally downsampled to `376` pixels wide and placed
  at the top of a `376 × 812` neutral canvas.
- Each combined comparison places the normalized source on the left and the
  final implementation rail on the right, separated by a `20px` neutral gutter.
- States: current-Tab collapsed draft; other-Tab group expanded with one saved
  card and one tagged draft; hidden draft selected and resumed in its original
  current-Tab composer.

Full-view and focused comparison evidence:

- The current-Tab header keeps the approved `评论 4` hierarchy and two compact
  full-width actions. The page-position draft card uses the same unselected
  saved-card surface, with only a small “未保存” status pill.
- The other-Tab state has one header action, keeps expansion inside the header,
  removes the redundant group count pill, and shows exactly the two cards
  counted by “其他标签页评论 2”.
- The resumed composer keeps the existing PageRoot target summary, textarea,
  attachment tools and primary action. The new trash action uses the same
  Phosphor tool-button treatment and leads to an inline confirmation.
- Focused comparisons are the rail crops themselves: every label, badge,
  border, icon and card gap remains readable at the implementation’s exact
  1× density, so a narrower secondary crop would not add evidence.

Required fidelity surfaces:

- Fonts and typography: existing PageRoot system-font family, optical weights,
  9–15px control hierarchy, line heights and truncation are retained. The
  generated source was normalized by rail width; its larger raster text is not
  treated as an implementation font-size requirement.
- Spacing and layout rhythm: header actions retain the approved stacked rhythm.
  Saved cards, collapsed drafts and composers use measured heights plus at
  least `16px` visible separation; the Browser oracle confirms the order
  remains `Tab comment 1 → Tab comment 2 → page comment → composer`.
- Colors and visual tokens: white surfaces, cool gray rail, violet status and
  focus tokens, neutral borders and shadows all reuse the existing comment
  card system. “未保存” is a quiet state label rather than a warning banner.
- Image quality and asset fidelity: this flow contains no raster product
  assets. Existing Phosphor caret, attachment, image, trash, close and comment
  icons are reused; no handcrafted icon or placeholder asset was added.
- Copy and content: “有一条未保存评论”, “其他标签页评论 N” and “未保存”
  match the approved copy. Close still means preserve; only the explicit
  “删除未保存评论” path can discard the draft.

Comparison history:

1. The pre-change rail gave the composer/focused item layout priority, which
   could move earlier page comments below it and let the recovery surface
   compete with saved cards. This was a P1 ordering and comprehension issue.
2. The first implementation removed focus-based ordering and unified all
   current-Tab items under one deterministic page-position layout. Browser QA
   then exposed a transient same-target fallback that could split two Tab
   comments while a hidden draft was restored.
3. Target positions are now normalized by shared Canvas marker identity,
   preferring measured positions over stale selection fallback coordinates.
   Post-fix Browser assertions wait for ResizeObserver measurement and prove
   the complete order plus a minimum `16px` gap before the final screenshots.

Interaction checks:

- Current-Tab shortcut locates and focuses the original composer without
  disappearing.
- Preview-to-Edit Tab switching moves the draft into the correct other-Tab
  group and removes the duplicate current shortcut.
- Clicking the entire hidden draft card switches back, restores the exact text
  and focuses the composer.
- Saving removes the shortcut in the recovery suite; explicit deletion removes
  shortcut, draft card and composer together.
- Main `评论 4`, send count and Canvas `评1` remain unchanged while the draft
  exists.
- Header expansion moves the rail items down without changing their relative
  order, and measured hover/composer states do not overlap.
- Browser console warnings and errors: none.

Findings:

- No actionable P0, P1 or P2 mismatch remains.
- Intentional differences from the generated images are limited to the two
  later user decisions documented under source visual truth.

final result: passed

---

## Workbench header height and overflow

Date: 2026-07-29

Source visual truth:

- User-provided macOS application capture (not committed) showing the two-line
  file summary and primary actions touching or crossing the old header divider.
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

---

# Comment rail design QA

## Comparison target

- Source visual truth:
  - `1-Photo-1.jpg` — user-provided, local-only Figma review capture.
  - `2-Photo-2.jpg` — user-provided, local-only Figma review capture.
- Superseding product direction: keep the existing saved-comment and unsaved-recovery card visuals unchanged; fix their positions only. Move other-tab summaries into the comment header, collapsed by default, with a compact expanded state.
- Rendered implementation:
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-bf6b9-der-and-avoid-draft-overlap/comment-rail-folded.png`
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-bf6b9-der-and-avoid-draft-overlap/comment-rail-expanded.png`
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-bf6b9-der-and-avoid-draft-overlap/comment-rail-draft-recovery.png`
- Combined focused comparisons:
  - `output/design-qa/other-tabs-comparison.png`
  - `output/design-qa/draft-position-comparison.png`

## Capture normalization

- Source images: 589 × 1280 px mobile screenshots of the Figma canvas.
- Implementation captures: 1600 × 900 CSS px, device scale factor 1, Desktop Chrome test runtime.
- Comparison crops: the source's visible comment-rail concept and the implementation's 400 px comment rail were normalized to a shared 760 px height. Browser/device chrome and the unrelated Canvas area were excluded from the judgment.
- State coverage:
  - other-tab summary folded by default;
  - compact expanded other-tab group and tab-location action;
  - current-tab saved comment aligned to its Canvas target;
  - existing unsaved-recovery card above a saved card without collision.

The Figma screenshots show the earlier expanded-card proposals, not a same-viewport production screen. Pixel-for-pixel comparison of the full frames would therefore be misleading. The focused comparison evaluates the revised information hierarchy, card preservation and spacing requested after those screenshots.

## Findings

- No actionable P0, P1 or P2 differences remain.
- Accepted intentional difference: the implementation does not reproduce the large unsaved draft card shown in Photo 1. It keeps PageRoot's existing `draft-recovery-card rail-status-card` presentation, as explicitly requested, and changes only its computed rail position.
- Accepted intentional difference: the large “其他标签页” card shown in Photo 2 is replaced by a compact header control. It is closed on entry and expands in place to show grouped tab labels, counts and a location action.
- Saved comment cards retain their existing component markup and visual classes. No `comment-card` visual rules were changed.

## Required fidelity surfaces

- Fonts and typography: existing PageRoot font family, optical weights, sizes and line heights remain unchanged for saved and recovery cards. New header metadata uses the existing compact UI scale and remains legible without wrapping the primary count.
- Spacing and layout rhythm: the header owns its measured height; Canvas-aligned cards begin below it. Saved comments, composer and recovery card share one collision-avoidance layout with a 20 px item gap. The tested recovery-to-saved-card gap is at least 16 px.
- Colors and visual tokens: existing neutral surfaces, borders, violet focus/accent color and shadows are reused. No new palette or gradients were introduced.
- Image quality and asset fidelity: this rail contains no custom raster imagery, illustration or logo asset. Existing icon components and product chrome remain unchanged.
- Copy and content: “其他标签页 N” communicates the folded total; expanded rows use the authored tab label and comment count. Existing saved-comment and unsaved-recovery copy is unchanged.

## Interaction and browser evidence

- Tested: save comments in two tabs, enter Preview, switch tabs, return to Edit, confirm only the preview-selected tab's card is Canvas-aligned, open the folded summary, switch/locate the other tab, and recover an unsaved draft without overlap.
- The interaction test passed at 1600 × 900.
- No actionable browser console errors or page errors occurred. The test runtime's expected sandbox message for intentionally blocked edit-frame scripts was excluded from the error set.

## Comparison history

- Initial Figma review: the proposed unsaved draft and other-tab sections consumed too much vertical space and changed existing card presentation.
- Product correction applied: preserve card visuals, move only the recovery position into the shared rail layout, and collapse other-tab content into the header.
- Post-fix visual evidence: the two combined focused comparisons above show the preserved card boundary, non-overlapping recovery position and compact header grouping.

## Implementation checklist

- [x] Existing saved-comment card styles unchanged.
- [x] Existing unsaved-recovery card styles unchanged.
- [x] Recovery and saved cards cannot overlap.
- [x] Other-tab comments are folded by default.
- [x] Expanded other-tab summaries remain inside the compact header.
- [x] Switching a summary activates and locates the corresponding tab comment.
- [x] Preview/Edit or tab context changes return the header to its folded state.

## Follow-up polish

- P3: with many unusually long tab names, a future density pass could add a bounded two-line label. This is not visible in the tested state and does not block acceptance.

final result: passed

---

# Tab comment hierarchy follow-up QA

## Superseding direction

- This follow-up supersedes the earlier compact grouped-summary treatment in
  “Comment rail design QA”.
- Source visual truth:
  - `output/design-qa/2026-07-30-tab-comments/source-tab-markers.png`
  - `output/design-qa/2026-07-30-tab-comments/source-comment-header.png`
  - `output/design-qa/2026-07-30-tab-comments/source-comment-expanded.png`
- Rendered implementation:
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-folded.png`
  - `output/playwright/native-dom-browser/results/native-dom-comment-tabs-co-5d63e-rds-and-avoid-draft-overlap/comment-rail-expanded.png`
- Combined comparisons:
  - `output/design-qa/2026-07-30-tab-comments/compare-tab-markers.png`
  - `output/design-qa/2026-07-30-tab-comments/compare-comment-header.png`
  - `output/design-qa/2026-07-30-tab-comments/compare-comment-expanded.png`

## Findings

- Tab comment counts now reuse the existing violet Canvas comment marker and
  render `评N` as one floating badge. Tab controls use a top-right placement so
  the count is not styled as authored Tab text and does not cover the next Tab.
- The redundant current-Tab label and count are removed from the comment
  header. The total comment count remains the primary header fact.
- The other-Tab trigger retains the existing full-width secondary-row
  hierarchy. Its expanded content increases the height of the same measured
  header instead of creating accordion cards outside it.
- Every expanded comment is a specific neutral saved-comment card, with the
  existing white surface, 16 px radius, subtle violet edge and quiet shadow.
  There is no selected or editing treatment until the user chooses the card.
- Clicking a card activates its authored Tab, collapses the header expansion
  and focuses that exact saved comment in the normal Canvas-aligned rail.

## Automated evidence

- The focused Browser case passed at 1600 × 900 with zero unexpected console
  or page errors.
- Geometry asserts that the center of the `评2` badge sits beyond the Tab's
  right edge and its bottom remains within the upper eight pixels of the Tab,
  keeping it visually floating rather than embedded.
- DOM ownership asserts that the expanded other-Tab region is a child of the
  comment header, and computed style asserts the neutral comment card has a
  white background and 16 px radius.
- The same case verifies the current-Tab label is absent, the exact other-Tab
  card switches the authored Tab and focuses its comment, and draft recovery
  retains at least 16 px clearance from the next saved card.

## Checklist

- [x] `评1` / `评2` use the existing Canvas marker visual.
- [x] Tab markers float outside the authored label treatment.
- [x] Current-Tab summary is omitted.
- [x] Other-Tab comments expand inside the top comment header.
- [x] Expanded entries use the neutral saved-comment card visual.
- [x] A specific card switches Tab and focuses the matching comment.
- [x] Keyboard focus and accessible names remain available.

final result: passed

## AI review workspace — adjacent same-summary badge aggregation

Date: 2026-08-18

### Problem

Every review overlay box may carry one summary badge ("新增内容", "视觉调整"…)
anchored above its top-right corner. Badge chrome is counter-scaled by
`--pageroot-review-ui-scale` (= 1 ÷ zoom) so it keeps a constant on-screen size.
In dense regions this made several same-kind badges stack and overlap each other
and the content beneath — worst at "适应" zoom, where the reach is largest. The
`核心结论` region alone stacked four `新增内容` captions over `实验效果概览` /
`锁单确认` / `CVR`.

### Comparison target

- Rendered before (crowding): `output/design-qa/badge-overlap-demo.png`
- Rendered after (aggregated): `output/design-qa/badge-aggregated-demo.png`
- Full state: `output/design-qa/ai-review-text-changes.png`

### Design decision

- Adjacent, same-summary, label-bearing boxes collapse into one representative
  badge that reads `{summary} ×N`. The four `新增内容` captions become a single
  `新增内容 ×4`.
- Aggregation is geometry preserving. Every change keeps its own outline,
  transparent mask hole and character evidence (green dots / red strike); only
  the repeated text caption collapses. No footprint, tone, mask or box identity
  changes, and the navigable "变化区域" count is untouched.
- It never merges different summaries and never links boxes that do not share a
  column or fall within one badge's vertical reach. The reach scales with zoom,
  so aggregation is more active at "适应" than at "100%".
- The focused change always stays the representative badge of its cluster, so
  navigation never hides the active change's caption.
- Badge count and the toolbar/navigator "变化区域" count remain two distinct
  meters: one region may hold several differently-labelled badges.

### Automated evidence

- The AI closed-loop smoke case passed 2/2 with zero unexpected console or page
  errors, and the design-QA capture regenerated cleanly.
- At "适应" the after canvas asserts that every `[data-pageroot-review-label-count]`
  badge carries `N ≥ 2` and its text ends with ` ×N`, proving a real cluster
  collapsed rather than a malformed count.
- The all-changes label invariant now allows an aggregated neighbour to carry no
  caption while still forbidding more than one caption per box or text group,
  and still requires at least one caption present.
- The pure aggregation helper is unit tested for cluster counting, same-column
  requirement, distance and different-summary independence, focus-preserved
  representative, suppressed-label exclusion, and input immutability.

### Consequence resolved

- This supersedes the entry-state batch's known consequence that overlay badge
  crowding became more visible at the "适应" default. Dense same-kind badges now
  aggregate instead of overlapping.

## Checklist

- [x] Adjacent same-summary badges render one `{summary} ×N` representative.
- [x] Every change keeps its outline, mask hole and character evidence.
- [x] Different summaries and distant/other-column boxes never aggregate.
- [x] The focused change stays its cluster's labelled representative.
- [x] The navigable 变化区域 count is unchanged by aggregation.
- [x] Helper is self-contained for iframe injection and unit tested.

final result: passed

---

# AI review entry-state and diff-legend QA

Date: 2026-08-18

## Superseding direction

- This entry supersedes two visual rules recorded in “AI review workspace —
  final seven-state contract”:
  1. the entry zoom is now `适应` instead of `100%`, so a dual-page comparison
     is fully visible on first paint instead of being cropped horizontally;
  2. before/after identity is no longer carried by the neutral and violet dots
     alone, and the toolbar is no longer free of red/green surfaces.
- Everything else in that contract stays in force: one quiet white review
  surface, neutral gray segmented shells, white selected tiles, the single
  violet selection family (`#6258d6` / `#4f47b8`) and the frozen persistent
  copy for the seven review states.

## Findings

- Entry state is `双页 + 全部变化 + 18% + 同步滚动 + 适应`. `100%` remains one
  click away on the same zoom axis; no state is derived from `pageView`.
- The `AI 修改后` pane header adds a 2 px violet inset top edge and a
  `#faf9ff` surface. The `修改前` header stays neutral, so the new version is
  identifiable after horizontal scrolling. The inset edge is drawn with a
  box shadow, which keeps the 36 px header row and the pane's 7 px rounded
  corners unchanged.
- `文案 / 结构 / 视觉` each carry 5 px legend dots that reuse the canvas diff
  tones by importing the same constants: removed red and added green for
  `文案`, structure blue for `结构` and visual violet for `视觉`. `全部变化`
  carries no dot. Selection emphasis remains the single violet family, so the
  legend explains the marks without becoming a second accent color.
- Change counts read as one two-level scale and stay mutually consistent under
  one filter. The toolbar shows `N 个变化区域` for all changes and
  `N/M 个变化区域` under a type filter, sharing its `N` with the navigator
  total. Content-map groups read `N/M 个区域有变化` for all changes and
  `N/M 个区域含…变化` under a filter, so a filtered `0` never reads as "this
  group has no changes at all". Canvas badges remain per-fact detail and are
  excluded from every one of these numbers.

## Automated evidence

- `assertReviewControlDefaults` in the Electron AI closed-loop spec asserts
  `适应` is pressed on entry, alongside the existing dual-page, all-changes and
  18 % default assertions.
- The same spec asserts that switching to a type filter lands on the first
  matching change (navigator reads `1` and the focused change has a rendered
  footprint), and that a target which still matches keeps the user's position.
- The mask-union pixel section now selects `100%` explicitly, because it maps
  in-frame CSS coordinates onto an element screenshot and needs 1:1 pixels; the
  projection-geometry section still asserts the same geometry under `适应` and
  `100%`, so both zoom modes stay covered.

## Known consequence

- The entry zoom change makes overlay badge crowding more visible in dense
  regions. Badge chrome is counter-scaled by `--pageroot-review-ui-scale` to
  keep a constant on-screen size, so at `适应` it covers proportionally more of
  the shrunken content than at `100%`; several adjacent `新增内容` labels can
  overlap each other and the text underneath. Tones, footprints and masks stay
  correct, and `100%` is one click away. Aggregating adjacent same-type badges
  into one `… ×N` chip is the proper fix and is deliberately out of this
  entry-state batch.

## Checklist

- [x] Dual-page entry is not horizontally cropped.
- [x] Filter switching never leaves the navigator on an unmatched target.
- [x] Region counts agree across toolbar, content map and navigator.
- [x] A filtered count never reads as an absolute "no changes" statement.
- [x] `AI 修改后` header is identifiable without reading its label.
- [x] Legend dots use the canvas tone constants, not a new palette.
- [x] Selection emphasis remains one violet family.

final result: passed

## Glass material unification: real translucency, warm-fog overlays and paper grain

Date: 2026-08-19

### What changed and why

An audit of all `backdrop-filter` declarations found most blurs were
decorative rather than material: surfaces at 94–98 % opacity gave the blur
nothing to transmit, and the modal overlays each used a different dim color
and blur radius (3/5/6/8/10 px). This entry replaces that drift with the one
formula the handoff console had already validated (deep blur, saturation
lift, inset top highlight) and records it in DESIGN_LANGUAGE.md §3.

- Review pinned toolbar, its handle, the content-map handle and the map
  panel: 95–98 % opaque white → 76–85 % white with
  `blur(20px) saturate(180%)` and an inset top highlight, so page content
  now visibly breathes through the chrome while the segmented controls keep
  their own opaque gray shells for readability.
- Modal overlays (project drawer, external-open confirmation, review adopt
  confirmation, About) unified to one warm fog: `rgb(34 32 27 / 36%)` +
  `blur(16px) saturate(140%)`, with the blur animating from 0 on entry via
  the existing overlay transition. The lightbox keeps its dark room and only
  tightens to blur(12px).
- Canvas floating tools (lock notice, editing toolbar, capability hint,
  edit-status pill, history banner, comment rail header, notice bar,
  first-edit guide card) now share the same glass family at 78–88 % opacity
  with `saturate(140–180%)`; the source-conflict banner stays fully opaque
  because a red alert must read as a fact, not a material.
- The shell and workbench base layers carry a 3.5 % alpha SVG `feTurbulence`
  grain (`--grain`), giving the flat paper tones a physical tooth. No
  gradients were added anywhere (2.2 stays intact).

### Design-language conformance

- One emphasis family (2.2): no new accent color; the review violet family
  `#6258d6` / `#4f47b8` and every segmented-control surface are untouched.
- Quiet first (2.3): nothing animates without a state change; the overlay
  blur only sweeps in while a modal opens.
- Honest surfaces: grid areas that never overlay content (title bar, fixed
  rail) keep their flat treatment — blur is only spent where content really
  passes beneath.
- DESIGN_LANGUAGE.md §3 gained a "材质与虚化" subsection so the formula is
  reusable instead of rediscovered.

### Evidence

- Real Electron review run (`PAGEROOT_CAPTURE_REVIEW=1`,
  ai-handoff-closed-loop "stays pending through desktop review", 1 passed):
  `output/design-qa/ai-review-final.png` (glass toolbar and handles) and
  `output/design-qa/ai-review-map.png` (map panel over live content).
- Real render from the vinext dev server, 1440×900 @2x:
  `output/design-qa/glass-workbench.png` (grain shell) and
  `output/design-qa/glass-project-drawer.png` (warm-fog overlay).
- `npm run gate:edit` passed (113 node tests, typecheck, architecture
  check); the Electron closed-loop spec passed unchanged, confirming no
  registered contract (violet family, segmented shells, copy) moved.

### Known consequence

- More live `backdrop-filter` area means slightly higher compositing cost;
  blur radii are deliberately capped at 20 px and the grain layer is a
  static 180 px tile, so no per-frame paint work is added.
- The in-flight open-html-picker branch rewrites the project drawer and the
  "+" popover on these same surfaces; whichever lands second should point
  the new popover chrome at the same glass family instead of reintroducing
  an opaque card.

### Checklist

- [x] Review toolbar, handles and map panel transmit page content visibly.
- [x] All dimmed modal overlays share one warm-fog recipe.
- [x] Grain is present on shell/workbench bases only; review surface pixels
      and diff masks are unaffected.
- [x] Review violet family, segmented controls and all copy unchanged.
- [x] Reduced-motion paths untouched (no animation added or removed).

final result: passed
