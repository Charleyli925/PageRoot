# ADR 0063: Canvas undo is a 20-step open-document memory history

- Status: Accepted
- Date: 2026-08-30
- Supersedes: ADR 0009 for current v4 editing

## Context

Persistent Canvas undo made one ordinary edit participate in a second durable
journal, cursor/action reconciliation, restart migration and history-specific
recovery. That product promise is larger than the value of restoring old undo
steps after a file switch or application restart. PR5 also needs to move the
existing text, style and sibling-order path onto the semantic operation kernel
without expanding Repository or Desktop Main responsibility.

## Decision

- `HtmlCanvasEditor` expresses each accepted source-backed edit as a semantic
  operation. The kernel independently materializes complete next HTML and the
  exact forward/inverse patches used by the active editing session.
- `SourceHistorySession` owns one memory-only stack for the currently open HTML.
  It retains at most the latest 20 accepted edit behaviors.
- Undo applies an exact inverse locally; redo applies the corresponding exact
  forward patches. A new edit after undo discards the redo tail.
- Switching to another HTML, closing the open document, disposing the session
  or restarting the app clears the stack. History never crosses an HTML file or
  an open lifetime.
- Undo/redo still produces complete HTML, advances edit revision and uses the
  normal Hash/CAS, atomic autosave, conflict and crash-recovery path. It does
  not create a Version.
- Recovery records may retain exact operations only as evidence needed to
  finish an interrupted save. They never restore user-visible undo/redo
  capabilities after restart.
- Focused native text fields keep their browser-local undo. Comment cards,
  attachments and other project actions do not enter Canvas history.
- The former persistent-history decoder and Bridge action route are retired.
  They cannot become a second history authority or writer for the memory stack.

## Consequences

- Canvas undo has a small, explicit product contract: same open HTML, same app
  session, most recent 20 edits.
- Autosave safety and complete-HTML authority remain unchanged, while durable
  history candidates, action IDs, cursor CAS, lock/replay reconciliation and
  restart history migration are no longer needed by the current editing path.
- Exact patches remain session-local implementation evidence. Runtime DOM is
  never serialized into source or history.
- Historical project records are not rewritten; the product simply has no
  reader, writer or action route for the retired journal format.
