# ADR 0002: Native edit hosts are measured capabilities

- Status: Superseded by [ADR 0004](../0004-v2-editable-islands.md) for PageRoot 0.9.0
- Date: 2026-07-23

## Context

Chromium can change collapsed source whitespace when an authored element becomes `contenteditable="plaintext-only"`. The previous layout gate correctly stopped those cases, but it also left safe text islands uneditable. A static rejection of any `display: contents` descendant similarly rejected event paths that work correctly when guarded at runtime.

Using an unconstrained rich-text surface would improve apparent coverage by expanding the trusted DOM mutation set, which conflicts with PageRoot's source-faithful local-patch model.

## Decision

PageRoot keeps one native DOM editing engine and chooses its host mode from a live capability preflight:

1. Prefer `contenteditable="plaintext-only"`.
2. If that mode changes layout or text style, try controlled `contenteditable="true"` with the complete session attribute set. Select it only when geometry, style, focus, Selection and restoration are stable.
3. Treat `display: contents` as observer-guarded when MutationObserver is available, rather than as an unconditional event-delivery failure.
4. Give neither fallback additional persistence authority. Paste is plain text, structural operations are blocked or rolled back, and every commit still requires native event evidence, FormatSkeleton validation, SourceTextMap identity, source Hash and SourcePatch.
5. Keep host modes, session attributes, disposable wrappers and editing timers in one native-edit policy module.

## Consequences

- Safe layout-sensitive and `display: contents` text islands can become editable without adding another editor engine.
- Browser differences are paid for through a synchronous activation preflight and guarded rollback.
- Unknown event delivery, structure, focus or restoration remains fail-closed.
- Buttons, code, form values, replaced content, foreign documents and ambiguous structural ranges still require dedicated editors.
- Browser and Electron gates must cover controlled paste, unowned structural mutation, observer-guarded input, blocked source-reversal shortcuts and byte-exact forward persistence.
