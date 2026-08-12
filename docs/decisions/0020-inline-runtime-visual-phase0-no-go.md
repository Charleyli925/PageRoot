# ADR 0020: Phase 0 keeps Edit static until native overlay input is proven

- Status: Accepted
- Date: 2026-08-12
- Extends: ADR 0017

## Context

The proposed inline runtime-visual direction aims to make a small class of
fixed Canvas/SVG chart mounts visible in Edit without using screenshots. It
must not change source authority, execute author scripts inside the Edit
iframe, create a second interactive surface, or make runtime state durable.

Before adding any production owner, PR-1 ran a synthetic Electron Phase 0
probe. A separate transparent runtime BrowserWindow gave the test a distinct
renderer process, an owner-initiated hard termination path, a trusted wrapper
with one sandboxed source iframe, and an SVG mask exposing two fixed rectangles.
The probe also demonstrated private `MessagePort` binding before the author
script, replacement detection, geometry agreement across resize/zoom/scroll,
and owner-registry cleanup.

Two user-facing requirements remain unproven in a CI-safe way: actual OS-level
pointer/selection/wheel/keyboard/IME traversal through the native overlay, and
final WindowServer composition of a visible overlay above the real editing
window. `setIgnoreMouseEvents()` plus CSS `pointer-events:none` is not enough
evidence for those behaviors. The hidden capture proves pixels inside the
runtime surface, not the user's complete native interaction path.

## Decision

- Record Phase 0 as **No-go for production implementation**.
- Do not add an inline runtime owner, overlay, flag, IPC/preload capability,
  runtime session, cache, retry path, or Edit UI in this workstream.
- Keep the present production contract from ADR 0017: Edit is source-backed,
  script-disabled and static; Preview owns authored interaction; Review alone
  owns its existing bounded runtime screenshot supplement.
- Keep Report HTML Profile v0.1 as a source-only, pure validator contract. A
  `profile-fixed` result is a static candidate tier, never a rendering grant.
- Do not turn the experiment into a production fallback or compensate by
  copying DOM/pixels, taking screenshots, creating per-chart pages, forwarding
  author events, or retaining a stale generation.
- A renewed Phase 0 must introduce a safe, repeatable native-input and
  visible-composition proof first. It requires a new decision record before
  any PR-2 implementation begins.

## Consequences

- Users receive no new prompts, status indicators, blank placeholders, or
  flashes. Edit behavior remains exactly as it is today.
- The project still gains a bounded content contract, diagnostics, source
  migration guidance, and a reproducible negative decision rather than an
  optimistic runtime implementation with hidden lifecycle debt.
- The rejected same-renderer-iframe route remains prohibited because an author
  script freeze cannot be independently terminated without risking Edit.
- `legacy-candidate` remains an informational source tier; it cannot expand
  support by library name, script scanning, filename, or real-page special case.

## Rejected alternatives

### Treat Electron configuration as sufficient pointer proof

Rejected because the user experience depends on selection, drag, context menu,
keyboard and IME as well as clicks. An API call or DevTools-directed event does
not demonstrate those events pass through an independently composited native
window.

### Show the hidden probe in normal Edit as a limited beta

Rejected because the unproven native path is exactly where user-visible focus,
input, flicker and composition defects would emerge. A feature flag does not
make an unproven interaction contract safe.

### Fall back to screenshots when a slot cannot be composed

Rejected because it recreates the cache, stale-frame, crop and lifecycle
complexity this proposal was explicitly intended to avoid.
