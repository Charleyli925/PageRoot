# ADR 0009: Canvas undo uses one persistent exact-Patch journal

- Status: Accepted
- Date: 2026-07-31

## Context

PageRoot previously blocked Canvas `Cmd/Ctrl+Z` because Chromium undo mutates
the disposable preview DOM and can bypass SourceIndex, TargetResolver,
SourcePatch and the atomic source writer. The macOS Edit menu therefore showed
Undo/Redo but could not safely reverse a persisted Canvas operation.

Users need undo for direct text, style, safe structure and sibling-order edits,
including after closing and reopening a project. They do not need a new Canvas
toolbar button or product-level undo for comment cards, attachments and other
project actions. Comment and project-rule text fields should retain familiar
field-local text undo.

## Decision

Canvas undo and redo use one bounded, persistent exact-Patch journal.

- `HtmlCanvasEditor` emits the actual forward patches and SourcePatch engine
  inverse patches for every accepted mutation. It does not own a stack.
- `SourceHistorySession` owns the renderer context, pending autosave operations
  and one history-action intent.
- The Bridge owns `history/source-operations.json`, limited to the most recent
  100 continuous operations, a 32 MiB operation-journal ceiling and a bounded
  applied-action ledger.
- Autosave validates the complete before/after Hash chain and prepares the
  source HTML and history JSON in the same runtime `pendingWrite` recovery
  boundary.
- Undo/redo carries a stable action ID, expected source Hash, history revision
  and cursor. The Bridge validates and applies exact inverse/forward patches,
  then returns canonical source bytes for the Canvas to adopt.
- Text operations may retain bounded before/after logical Selection metadata.
  The renderer fences the old editable document, adopts the canonical history
  result in one replacement, and resumes the same source-backed host and caret;
  Selection metadata is never HTML authority.
- The operation's before/after TargetRef pair is also the deterministic
  identity bridge for comments that point at the same source element through a
  different target ID. Generic rebinding remains the fallback for unrelated
  targets and genuine orphans.
- An unknown response is reconciled against workspace authority before the
  same action ID is replayed once. Replays cannot apply a patch twice.
- A forward edit after undo truncates redo. An external source change, working
  file transition or broken Hash chain establishes a new history boundary.
- The existing desktop Edit menu routes intent by focus. Native text controls
  use Electron/Chromium local undo; eligible Canvas focus uses persistent
  source history. A composing project-rule field pauses autosave, and explicit
  restore retires the marked-text control before accepting more input. No
  toolbar entry is added.

## Rejected alternatives

### Serialize preview DOM snapshots

Rejected because the preview contains instrumentation, transient editing DOM
and browser normalization. It would violate source-byte authority and grow
storage with full-document copies.

### Keep a renderer-only undo stack

Rejected because it disappears on restart, races autosave acknowledgement and
becomes a second authority beside disk.

### Reconstruct inverse operations from audit events

Rejected because audit records describe user-visible changes but are not
complete byte patches and cannot safely restore quoting, whitespace, comments
or reordered fragments.

### Add independent history to every product object

Rejected for this scope. Comment/card, attachment and project operations have
different identity and persistence rules. Only focused text controls retain
their existing native input history.

## Consequences

- Canvas undo/redo preserves source fidelity and survives restart without a new
  visible control.
- History storage is proportional to changed ranges rather than document size,
  but large edits are still bounded and may be rejected rather than weakening
  limits.
- Undo/redo is a real source write: it advances edit revision and audit state,
  participates in Hash conflict and crash recovery, and does not create a
  Version.
- Field-local native undo is session-local and intentionally does not survive
  application restart.
- A canonical history replacement keeps the last proven comment geometry until
  the new Canvas reports its targets, so transient iframe absence is not
  presented as a moved/orphaned comment.
- Tests must cover all four Canvas mutation categories, menu/shortcut routing,
  exact bytes, active host/Selection restoration, comment identity and
  geometry, cold reopen, idempotent replay, both sides of the source commit
  point, and late native composition delivery after project-rule restore.
