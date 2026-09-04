# ADR 0015: Safe host fallback and exact direct-text-node editing

- Status: Superseded by [ADR 0004](../0004-v2-editable-islands.md); mixed parents are ordinary editable islands with frozen non-inline subtrees, so the disposable text-fragment host and direct-text-node command are retired.
- Date: 2026-08-07

## Context

An inline source element can be a safe editable island even when its parent is
a mixed block container that is not. Promoting the inline element to that
parent made the whole activation fail. Direct text children of the same parent
had no element boundary of their own, so they could not enter the sole V2 text
controller without treating unrelated block descendants as editable source.

## Decision

- Transparent inline host discovery remembers the nearest safe editable island.
  It promotes only while each new candidate is safe and falls back to that
  remembered descendant when a complex parent is unsafe.
- A uniquely mapped direct source text node under an unsafe parent may mount one
  disposable inline host. The existing `IslandEditingController` owns its
  Selection, input, deletion and IME lifecycle; no second text engine exists.
- The disposable host must preserve parent geometry and computed text style and
  must not expose generated pseudo-content. It accepts plain text only.
- `update-direct-text-node` replaces exactly the text node's source range. The
  operation TargetRef is the surviving direct parent, while metadata carries
  the exact text TargetRef used to plan and authorize the forward Patch. This
  keeps complete deletion invertible without widening the write scope.
- The runtime host, editing attributes and source-node instrumentation remain
  preview-only and are unwrapped at every session boundary.

## Consequences

- Existing safe paragraphs and mixed-inline islands keep their previous host,
  normalization and SourcePatch behavior.
- Safe inline descendants and direct bare text become editable inside otherwise
  unsupported mixed block containers; the block structure itself remains
  comment-only.
- Line breaks and inline markup are rejected in a direct-text fragment because
  either would turn one text node into structural source. Full editable islands
  retain their existing formatting and hard-break behavior.
- Ambiguous, nested, runtime-generated, layout-changing or stale text fragments
  continue to fail closed without changing source bytes.
