# Design QA

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
