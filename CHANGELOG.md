# Changelog

Notable user-visible changes are documented here. This project follows Semantic Versioning for public releases.

## [Unreleased]

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

[Unreleased]: https://github.com/Charleyli925/PageRoot/compare/v0.8.5...HEAD
[0.8.5]: https://github.com/Charleyli925/PageRoot/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/Charleyli925/PageRoot/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/Charleyli925/PageRoot/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/Charleyli925/PageRoot/compare/v0.7.4...v0.8.2
[0.7.4]: https://github.com/Charleyli925/PageRoot/releases/tag/v0.7.4
