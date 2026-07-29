# Design QA

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

---

# Comment rail design QA

## Comparison target

- Source visual truth:
  - `/tmp/codex-remote-attachments/019fad88-a910-73c0-8840-414499126a83/300F605D-B05A-41EF-A242-B571A8BCA3D3/1-Photo-1.jpg`
  - `/tmp/codex-remote-attachments/019fad88-a910-73c0-8840-414499126a83/300F605D-B05A-41EF-A242-B571A8BCA3D3/2-Photo-2.jpg`
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
