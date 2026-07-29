# Changelog

Notable user-visible changes are documented here. This project follows Semantic Versioning for public releases.

## [Unreleased]

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

[Unreleased]: https://github.com/Charleyli925/PageRoot/compare/v0.9.4...HEAD
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
