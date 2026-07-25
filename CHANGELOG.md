# Changelog

Notable user-visible changes are documented here. This project follows Semantic Versioning for public releases.

## [Unreleased]

- Automatically normalize persisted whole-page comments across restarts so legacy records no longer block Qoder submission or require users to reselect “全局评论”.
- Make global notifications opt-in, automatically recover transient reads and unknown AI outcomes, and keep file, canvas, rule, attachment, and processing feedback in context instead of asking users to repeat failed actions.
- Replace raw scope-code warnings with concise before/after summaries and an explicit “采用这些额外变化” decision.
- Remove the product-level 100-comment cap while retaining virtualized rendering for large review rounds.

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

[Unreleased]: https://github.com/Charleyli925/PageRoot/compare/v0.8.7...HEAD
[0.8.7]: https://github.com/Charleyli925/PageRoot/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/Charleyli925/PageRoot/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/Charleyli925/PageRoot/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/Charleyli925/PageRoot/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/Charleyli925/PageRoot/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/Charleyli925/PageRoot/compare/v0.7.4...v0.8.2
[0.7.4]: https://github.com/Charleyli925/PageRoot/releases/tag/v0.7.4
