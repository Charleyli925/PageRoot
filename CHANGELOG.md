# Changelog

Notable user-visible changes are documented here. This project follows Semantic Versioning for public releases.

## [Unreleased]

- Separate exact AI-review copy evidence from the frame users read. Nearby
  fragments now form bounded phrase or line rectangles, tiny edits gain a
  line-local readable width, stable sentences stay separate, and dense
  multi-line rewrites become one smallest-owner “段落改写” frame instead of a
  jagged union outline. Each semantic group carries one label. Removed copy
  keeps its red dashed strike and red dashed frame; added copy keeps its green
  dashed frame without an underline or background treatment.
- Stop treating AI-authored script changes as an adoption failure. Candidate
  assessment now checks document usability and coarse continuity only; retired
  executable-surface fields in historical records are verified, normalized out
  of current status, and never rewritten or exposed as a present-day warning.
  Genuine assessment read errors also show an accurate failure instead of
  being mislabeled as a timeout.
- Keep AI review text frames aligned to semantic punctuation and word ranges.
  Replacing “品均基本持平” with “单品效率整体稳定，增幅仅+0.10%” now
  marks the complete old and new phrases instead of treating their accidental
  shared “品” character as unchanged or splitting the green frame. Short Chinese
  replacements remain pairable, while distant edits in long punctuation-free
  copy no longer pull the unchanged text between them into one oversized frame.
- Make visual-review frames follow the element that owns the changed paint or
  layout. Whole-card background, border, radius, shadow, size and layout
  changes now keep one complete component frame and matching mask hole, while
  logical block sizing follows the same rule. Inherited copy styling now uses
  the rendered text ranges instead of its container box, and neighboring cards
  cannot merge merely because they are close together.
- Show script-generated Canvas, SVG/HTML charts and dynamic table bodies
  automatically in desktop Edit as one source-Hash-bound read-only bitmap
  projection. The bitmap remains pointer-transparent so comments target the
  original HTML host, while source save, review diff, versions and AI input
  continue to use the complete original HTML without PageRoot projection data.
- Give developer test packages a distinct `PageRoot Developer Preview` app
  identity and deterministic versions derived from the latest formal tag; for
  example, the first two committed previews after `0.9.5` are `0.9.69991` and
  `0.9.69992`, with the exact source commit appended to the full preview
  version so divergent branches cannot share an app or DMG identity.
- Require every formal or developer installer handoff to include an exact
  package-content report with artifact Hash, source range, all associated Pull
  Requests, their live status and one-line purpose, plus direct commits without
  a Pull Request.
- Treat an unqualified latest-package request as current `origin/main` plus all
  applicable, non-excluded PR heads; compose unmerged work on a temporary
  integration branch and keep any such installer Developer Preview-only.
- Update Next.js and its ESLint configuration to 16.3.0, and refresh compatible
  transitive build dependencies so the dependency audit has no active security
  exceptions.
- Keep the desktop workspace Bridge startup pending while macOS is waiting for
  Documents-folder authorization, then resume the same launch automatically
  once the service reports ready instead of showing a false 12-second timeout.
- Restrict desktop interactive preview to declared local assets, including
  assets reachable from inline CSS and module imports, and reject dotfiles,
  undeclared sibling files, escaping symlinks and `file:` resource bases.
- Preserve the AI-Agent cancellation warning after reopening a processing
  Request whose prior clipboard handoff can no longer be proven.
- Fixed project and generated-Version switching so project identity, source
  path, Version authority, HTML bytes and Hash publish together; edit/preview
  canvases now acknowledge the same generation, safe-save status cannot reuse
  stale content, and the “+” project picker automatically repairs one clean
  projection mismatch instead of silently doing nothing.
- Reconciled safe close against the exact frozen HTML bytes so stale Canvas
  Hash or revision projections no longer contradict a “Safely saved” status.
  Matching authoritative bytes now repair the projection silently; confirmed
  external divergence or invalid source integrity stays fail-closed with an
  in-app recovery path. Renderer-owned blockers return to that path without a
  duplicate macOS alert, while missing, timed-out or faulty close coordination
  still uses the native fallback.
- Replaced subtree-exact AI acceptance with a simpler candidate check: complete
  visible HTML is the content requirement, while coarse page continuity routes
  uncertain results into mandatory side-by-side review instead of falsely
  failing broad but valid edits.
- Localized terminal AI errors, fixed long error text overlapping the process
  timeline, reduced duplicate terminal actions to one “Return to editing”
  action, and added a restart-safe “Previous run” entry for reopening the last
  error or no-change outcome.
- Made AI results review-first: ready results now offer a highlighted
  side-by-side review and a secondary direct-open action, with full-page
  change filters, synchronized navigation, and a reversible return-before-AI
  confirmation before the same audited activation path is used.
- Rebuilt the formal AI review workspace around independent page, change
  filter, context visibility, navigation, page-runtime, scrolling and zoom
  state. Page and filter buttons now remain selected independently, map
  navigation no longer changes review display, and single- and dual-page views
  fill the available Canvas with only minimal framing gaps.
- Unified Canvas comments and formal review on one Tab-discovery contract,
  including explicit and strict indexed page controls. Review now coordinates
  both pages through one presentation epoch, removes stale frames immediately,
  keeps dimming continuous while different-height Tabs settle, and converges
  linked vertical scrolling instead of jumping. Every semantic change group
  carries one short label, and its final readable rectangles provide the mask
  holes without a separate dimming geometry. Frozen user comments also
  appear only on the before page as a persistent read-only “评” marker with a
  hover-only bubble.
- Reworked linked review scrolling around a single input owner and a cached,
  monotonic semantic map. The active page now keeps native scrolling and
  momentum while the follower applies only the newest target per frame;
  rapid reversals and side switches invalidate stale work, unequal page
  boundaries no longer pull the longer page to its end, and scroll events no
  longer rebuild overlays or remeasure comment targets. Page-overview jumps
  now invalidate the active gesture before returning both panes to the top,
  and bounded comment coordinates remain available in very long documents.
- Unified review frames and dimming on one typed change footprint. Copy uses
  leaf-level exact ranges and high-confidence pairing instead of tag/position
  guesses. Connected frames merge without crossing columns, contained ancestor
  frames are removed, and the context mask now punches transparent holes from
  those exact final rectangles so frame interiors remain clear. Added copy uses
  green frames, removed copy red, structure blue and visual changes purple;
  repeated short copy and inserted structures no longer create unrelated text
  or visual frames. Before/after controls now use paired stable identities and
  mirror Tabs, disclosures, buttons and form state in both directions even
  while scrolling is independent; unsupported matches degrade silently.
- Made review open directly on the first change in synchronized dual-page All
  mode with 18% context. Added copy keeps the page's authored styling and uses
  one merged dashed frame; removed copy keeps its deletion treatment, while the
  final frame rectangle—not incidental DOM ancestry—defines the fully clear
  region for each Copy/Structure/Visual projection.
  The content map opens to the right of its handle, distinguishes changed rows,
  and dismisses on outside interaction. Linked review now mirrors authored
  page actions and form state, not only Tabs. Return confirmation locates the
  exact candidate HTML, while acceptance keeps review covering the live editor
  until the candidate is rendered, eliminating the waiting-page flash.
- End Canvas selection and native text editing when the user clicks elsewhere
  in the page or App—including blank space in the top bar or comment rail—by
  committing the current checkpoint and removing the edit toolbar and selection
  together. Selection-bound toolbar, comment-card and composer actions remain
  stable long enough to complete their intended operation.
## [0.9.5] - 2026-07-31

- Run desktop interactive previews in a short-lived isolated document so
  authored scripts, relative assets, Tab controls, SVG, Canvas and dynamic
  tables work without weakening the PageRoot renderer CSP.
- Make “Edit” return to the source-backed Tab selected in preview while keeping
  the normal script-disabled editable-island canvas, source bytes and existing
  native-action interception authoritative.
- Keep script-rendered Canvas charts and dynamic table rows visible in Edit as
  bounded, non-editable projections without copying them into source HTML.
- Keep current-tab comments aligned with the Canvas, render Tab comment counts
  as the existing floating violet `评N` marker, and remove redundant current-Tab
  metadata from the comment header. Other-Tab comments now expand as neutral
  saved-comment cards inside that header. Unsaved comments now stay at their
  page position, use one persistent current-Tab shortcut or a tagged card in
  the appropriate other-Tab group, and keep stable document order through
  focus, expansion and Tab changes until explicitly saved or deleted.
- Keep comment-card geometry fixed while actions appear, strengthen the focused
  boundary, align an explicitly selected card by translating the unchanged
  queue, and route wheel input over the rail through the shared page before
  restoring comments hidden above the top edge. Dense comments are now clipped
  at the Canvas page bottom instead of stretching a short HTML page; continued
  wheel input at that bottom pulls the remaining queue into view.
- Treat saved-comment text and attachment edits as one recoverable transaction:
  unchanged edits cancel automatically on Tab changes, while changed but
  unconfirmed edits remain available from an “unsaved modification” shortcut.
- Allow direct text edits beside preserved nested lists and `<wbr>` boundaries
  while keeping those authored structures byte-safe and non-editable.
- Added a concise AI Agent warning before ending a copied run, restored editing
  with a clear manual-stop reminder, and made late official finalization return
  a non-retryable cancelled result without creating a new Version.
- Save an in-place filename edit when the user clicks blank title-bar space,
  matching the existing Enter and click-away behavior without changing file
  identity or version history.
- Let edit mode reveal source-backed Tab panels, including strict explicit-ID
  and constant-number indexed report Tabs, plus native details and local
  disclosure regions from the selection toolbar or Option-click, while links,
  forms, popups, drawers and authored scripts remain inert.
- Keep the HTML identity icon centered on the two-line file summary in all
  three no-update, `New!` and `New! 重启更新` states; the update label overlays
  the icon independently without shifting the title-bar layout.
- Added persistent, source-exact undo and redo for Canvas text, style, safe
  structure and sibling-order edits through the existing macOS Edit menu and
  keyboard shortcuts, including continuation after reopening a project.
- Kept comment, project-rule and other focused text inputs on their native
  field-local undo history without adding a Canvas toolbar action or extending
  product-level undo to cards, attachments and other project operations.
- Restored the active Canvas text host and caret without a visible intermediate
  reload, kept comment anchors stable through undo/redo, and prevented late
  Chinese-composition input from reappearing after project-rule restore.
- Simplified About PageRoot by removing redundant platform, license, telemetry
  and update-channel labels while preserving the current version, architecture,
  update action, repository link and local user notice.
- Made project identity ID-first across comments, attachments, history, AI
  handoff and rapid project switching; equivalent local paths are canonicalized,
  stale project callbacks and unrelated same-path replacements fail closed,
  project-rule saves retain complete identity, and internal identifiers or paths
  are no longer surfaced as user-facing recovery messages.
- Refactored Workbench state into explicit project, document, comment, history,
  version and AI-run sessions, extracted presentation and Canvas modules, and
  retired the unused V1 editing path while keeping the V2 source-patch contract.
- Added governed task worktree audit, synchronization and retirement commands
  so active changes remain visible and protected throughout parallel work, with
  merged retirement proof bound to the exact current branch head.
- Aligned developer-preview and formal-candidate CI evidence validation with
  their preflight, signing, notarization, checkpoint and final-artifact stages
  so packaging cannot stop because of an unsupported stage name.
- Rebuilt the deterministic renderer comparison input in the candidate's fresh
  final-artifact job before revalidating the restored notarized App, while
  keeping the signed checkpoint App immutable.
- Restored the exact embedded build provenance and telemetry configuration from
  that checkpoint before fresh-job payload verification, without regenerating
  configuration or exposing its project token to final packaging.

## [0.9.4] - 2026-07-29

- Increased the workbench header height and bottom breathing room so the
  two-line file summary and all primary actions remain inside the title bar.
- Added compact filename actions for opening another local HTML and opening
  the current known HTML in the system default browser, with small hover and
  keyboard-focus tooltips that do not change header geometry.
- Made default-browser launch wait for the exact current edit revision to be
  safely written, and added fail-closed executable coverage for malformed,
  unknown, unsafe and unauthorized launch requests.

## [0.9.3] - 2026-07-29

- Added an always-visible, bolder plus action beside the current filename that
  opens the local HTML picker through the existing safe project-switch flow,
  while keeping the rename pencil hover-only and independently clickable.

## [0.9.2] - 2026-07-29

- Reframed the first-run welcome project and bilingual GitHub homepage around
  agent-agnostic local handoff, with Claude Code, Codex, WorkBuddy, Qoder and
  other filesystem-capable AI agents presented as compatible choices.
- Added concise AI Agent collaboration positioning to About PageRoot, replaced
  its duplicate update-schedule footer with a fixed local user notice entry,
  and packaged the complete statement and disclaimer with the macOS app.
- Added default-on, pseudonymous product telemetry for module use, project
  flows, edits, saves, faults, notifications and interruptions, with a strict
  no-content allowlist, local batching and an in-product usage-data notice.
- Redesigned the four-stage Qoder handoff flow with aligned numbered cards,
  stage-specific icons and explicit status pills, while moving the divider-free
  footer actions closer to the content.

## [0.9.1] - 2026-07-28

- Upgrade complete 0.9.0 project records additively on first start while
  retaining their existing UUID directories and every historical artifact.
- Clarified generated AI handoff files with PageRoot branding, plain-language
  sections, explicit run identities and clearer default project rules while
  preserving the existing frozen JSON protocol.
- Increased saved-comment text and edit text to 14px, collapsed comment tools
  until hover, keyboard focus or editing, and simplified normal and editing
  cards to one boundary with a compact divider-free action row.
- Name project-record folders from the HTML filename, project creation time and
  a short identity suffix, while retaining the full `projectId` as internal
  metadata.
- Keep Finder's regular `.DS_Store` metadata inert inside live AI Attempt
  folders, and mark an AI return only after the mandatory completion signal
  has actually appeared.
- Added stable-only macOS update checks with user-started differential
  ZIP/blockmap downloads, a restart confirmation, and the existing safe editor
  drain before installation.
- Added four-hour update checks while the app remains open, plus a redesigned
  About PageRoot dialog with manual update checking and the official GitHub
  repository link.
- Kept update status to one right-aligned red italic `New!` label above the
  Qoder handoff button, with no Canvas completion banner, progress animation or
  extra header icon.
- Replaced ad-hoc distribution with fail-closed Developer ID signing, Hardened
  Runtime, Apple notarization and candidate verification of both DMG and updater
  assets while retaining the legacy manifest for one-time migration.
- Added safe in-place filename editing for the current HTML: double-click the
  saved title, edit only its stem, and keep the same file bytes, Project,
  Document and Version history through collision checks and crash recovery.

## [0.9.0] - 2026-07-28

- Promoted the editable-island editor from the isolated V2 comparison build to
  the official PageRoot application, installer and GitHub update channel.
- Replaced the production native-text state machine with one controlled editable
  island route: outside bytes stay exact, while the edited island may be
  minimally normalized for visual, semantic and structural safety.
- Added deterministic start/middle/end insertion, grapheme deletion, line
  breaks, plain-text paste, frozen-selection IME replay and left-style boundary
  inheritance across paragraphs, headings, links, buttons, lists, tables,
  preformatted text, vertical writing and immutable embedded atoms.
- Kept edit warnings visible at the application viewport while the HTML page is
  scrolled, and added exhaustive synthetic plus opt-in real-complex-page edit
  censuses with machine-readable success/failure reports.

## [0.8.10] - 2026-07-27

- Allow ordinary typing at editable paragraph starts and ends, inline-style boundaries and link boundaries while preserving the intended neighboring style and exact source whitespace.
- Prevent links and authored controls from navigating while they are being edited, and keep final visible punctuation deletion source-exact.
- Simplify the Canvas comment surface by removing duplicate global-target copy and user-facing undo/redo history.
- Keep dotted PageRoot versions intact in exported HTML filenames.
- Make stale comment-draft reconciliation plus clean close/reopen a mandatory packaged-App release proof, while replacing repeated high-volume UI setup with lower-cost invariant coverage.

## [0.8.9] - 2026-07-26

- Treat already acknowledged deletion tombstones as durable Bridge authority when comparing draft content, so unchanged close and restart drains no longer create redundant operation IDs or advance the draft revision.

## [0.8.8] - 2026-07-26

- Unified project, document, draft, run and close ownership behind typed application services so the renderer and Bridge can no longer advance different identities or revisions.
- Reconcile stale or uncertain comment-draft writes against the authoritative Bridge draft, preserve deletions with durable tombstones, and avoid creating a new draft revision when close or project switch only verifies unchanged content.
- Rebase stale draft operations with stable operation IDs, replay them exactly once, reject impossible revision jumps, and recover the one valid artifact-ahead crash window without resurrecting deleted comments.
- Route close, project switch, Request submission and history boundaries through one drain coordinator; Electron close now waits for the exact source and draft generations while browser `beforeunload` remains browser-only.
- Retain Bridge-unavailable recovery until the Workbench listener acknowledges readiness, then replay it after renderer reloads instead of losing the only recovery action.
- Keep the packaged `parse5`/`entities` runtime on one verified dependency version and reject nested or incomplete Bridge dependency closures before building an installer.
- Keep only one unsaved comment at a time, reopen the processing panel when entering an active run, and preserve the Canvas scroll position when selecting commented content.
- Automatically normalize persisted whole-page comments across restarts so legacy records no longer block Qoder submission or require users to reselect “全局评论”.
- Make global notifications opt-in, automatically recover transient reads and unknown AI outcomes, and keep file, canvas, rule, attachment, and processing feedback in context instead of asking users to repeat failed actions.
- Replace raw scope-code warnings with concise before/after summaries and an explicit “采用这些额外变化” decision.
- Remove the product-level 100-comment cap while retaining virtualized rendering for large review rounds.
- Restored full-fidelity rendering for the frozen HTML preview and made preview/history return bars auto-collapse into a discoverable 2px edge that reopens on hover, focus or click.
- Added architecture contracts, a state-ownership registry, engineering standards, an ADR and executable CI checks that reject direct view-level Bridge/storage writes, duplicate lifecycle authority and uncoordinated drain paths.

## [0.8.7] - 2026-07-24

- Updated the exact App bundle allowlist and its fixture to verify the managed welcome-page module and logo that were added in 0.8.6, allowing a new immutable patch release without moving the failed 0.8.6 tag.

## [0.8.6] - 2026-07-24

- Refined “项目资料” into clear project-rule and Finder record actions, added a safer rules editor with loading/read-only/unsaved states, and prepares project records when the panel is opened.
- Restored the automatic GitHub update result as a compact `Update` action above “发送至 Qoder”; it opens the fixed latest-release page and never downloads silently.
- Isolated Qoder clipboard feedback, Request submission, cancellation, validation waiver, conflict resolution, result activation, and status polling by project and run identity.
- Prevented rapid duplicate submits from creating more than one Request and kept clipboard failures recoverable without disabling other projects.
- Hardened rapid switching and close recovery by rebuilding a missing autosave job from the authoritative in-memory revision and preventing a retired project's failure callback from contaminating the current project.
- Added a non-cancelling close action to the processing panel and made closed drawer overlays stop intercepting the canvas immediately.
- Canonicalized equivalent local paths such as `/var` and `/private/var`, kept one current source identity, and made consecutive generated versions survive relaunch without duplicate-document lockouts.
- Aligned AI supplement instruction identities across recording, sealing, scope validation and history, while allowing only exact before/after values explicitly authorized by an active supplement.
- Added compound-value comment targeting plus a 100-comment hard cap, shared markers and virtualized comment rendering for dense review rounds.
- Unified global and Canvas recovery feedback into one persistent, actionable `NoticeBar`, including safe file, attachment and blocked-edit recovery.
- Reduced repeated release validation by binding the full PR gate to an exact Git Tree Hash, using a fast post-merge smoke, and reusing fresh matching source evidence for installer-only release verification.
- Provision the first-run welcome page as a persistent ordinary HTML project with its own initial workspace, so edits, comments and QoderWork handoff work before users import another file.

## [0.8.5] - 2026-07-23

- Published the 0.8.4 source feature set from a new immutable release tag after the earlier artifact run stopped before publication.
- Updated the packaged-runtime release gate to exercise the current keyboard export path instead of a retired always-visible action.

## [0.8.4] - 2026-07-23

- Expanded source-preserving native text editing to more safely mapped text hosts.
- Added source-owned hard breaks, plain-text multiline paste, and simple paragraph or list-item splitting with undo and redo coverage.
- Reduced repeated DOM scans and draft copying on the native editing hot path.
- Redesigned the review workspace, project/version panels, comment tools, AI handoff state, and built-in welcome page.
- Added paired canvas/comment focus, dense-comment layout, full-bleed edit and preview surfaces, and a compact processing view without an outer scrollbar.
- Reserved the source tag; no installer assets were published after the packaged-runtime gate stopped before publication.

## [0.8.3] - 2026-07-23

- Opened the PageRoot source repository under Apache-2.0.
- Established repository governance, CI, release provenance and reproducible release assets.
- Prevented the packager from publishing before the complete artifact gate succeeds.

## [0.8.2] - 2026-07-23

- Completed the source-preserving native DOM editing path and automated persistence safeguards.
- Added deterministic browser, Electron, AI closed-loop and packaged-artifact gates.
- Added manual GitHub release update checks and PageRoot-branded macOS artifacts.
- Reserved the source tag; no installer assets were published after the release pipeline stopped before publication.

## [0.7.4] - 2026-07-20

- Published the first public macOS release in this repository under the earlier YuanYe artifact name.

[Unreleased]: https://github.com/Charleyli925/PageRoot/compare/v0.9.5...HEAD
[0.9.5]: https://github.com/Charleyli925/PageRoot/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/Charleyli925/PageRoot/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/Charleyli925/PageRoot/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/Charleyli925/PageRoot/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/Charleyli925/PageRoot/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Charleyli925/PageRoot/compare/v0.8.10...v0.9.0
[0.8.10]: https://github.com/Charleyli925/PageRoot/compare/v0.8.9...v0.8.10
[0.8.9]: https://github.com/Charleyli925/PageRoot/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/Charleyli925/PageRoot/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/Charleyli925/PageRoot/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/Charleyli925/PageRoot/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/Charleyli925/PageRoot/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/Charleyli925/PageRoot/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/Charleyli925/PageRoot/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/Charleyli925/PageRoot/compare/v0.7.4...v0.8.2
[0.7.4]: https://github.com/Charleyli925/PageRoot/releases/tag/v0.7.4
