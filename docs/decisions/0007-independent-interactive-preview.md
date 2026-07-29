# ADR 0007: Interactive preview uses an independent document and source-backed edit context

- Status: Accepted
- Date: 2026-07-29

## Context

Desktop preview previously used `srcdoc`. The frame inherited the application
renderer's `script-src 'self'` Content Security Policy, so authored inline and
external chart scripts did not run even when the iframe sandbox allowed
scripts. Relaxing the host CSP or enabling scripts in the editing iframe would
expand application authority and conflict with the source-faithful editable
island model.

A full runtime DOM snapshot is also not a safe editing projection. Script-added
table rows, chart labels, rewritten text and moved nodes have no stable source
identity. Copying them into `HtmlCanvasEditor` would trip its source/DOM
consistency checks, invite runtime data into SourcePatch, and destabilize
Selection and IME.

## Decision

- Electron registers one standard, secure `pageroot-preview:` scheme before the
  app is ready. The scheme does not bypass CSP.
- The main process owns bounded, short-lived preview sessions. A trusted
  application main frame may create or revoke a session through two narrow IPC
  methods. Preview subframes receive no PageRoot preload API.
- A session serves prepared HTML, one fixed bootstrap script and ordinary files
  realpath-contained by the known source HTML directory. It does not expose an
  arbitrary filesystem reader.
- The application renderer CSP remains `script-src 'self'`; only `frame-src`
  admits the preview scheme.
- Returning from preview captures a bounded `PageViewContext`. It may carry
  source-backed active/inactive class transitions plus `hidden`, `open`,
  `aria-selected` and `aria-expanded`. Stale Hashes, duplicated/unknown nodes,
  truncated captures, arbitrary runtime classes and all text/HTML/style/form/
  scroll/runtime-child state are rejected.
- `HtmlCanvasEditor` remains mounted, script-disabled and source-authored. It
  applies the accepted context as disposable presentation attributes, then
  continues to use the existing editable-island and SourcePatch path.
- Reports that must remain visually complete while editing provide static
  source fallbacks: inline SVG first, static table HTML, and PNG only where a
  static vector/HTML representation is not practical. JavaScript is progressive
  enhancement.

## Consequences

Desktop preview behaves like the authored page without weakening PageRoot's
renderer CSP. Clicking Edit preserves the selected source-backed Tab with no
new mode or user step, and existing text editing, Selection and IME keep their
current source/DOM assumptions.

Runtime-only content remains visible only in preview. Supporting arbitrary
runtime visuals in the editing surface would require a separate read-only
visual layer with geometry, scroll and lifecycle synchronization; that is
deliberately outside this decision.
