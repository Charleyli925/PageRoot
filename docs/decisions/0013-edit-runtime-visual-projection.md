# ADR 0013: Edit runtime visuals are disposable source-host bitmap projections

- Status: Accepted
- Date: 2026-08-04

## Context

The edit iframe deliberately disables authored scripts so source mapping,
Selection, IME and SourcePatch remain authoritative. Many existing reports,
however, author an empty host and populate it at runtime with ECharts Canvas,
SVG, arbitrary HTML or table rows. The previous preview-to-edit workaround
captured only one Canvas or sanitized `tbody` after a user first entered
Preview. It missed SVG/HTML renderers, depended on a mode transition and made
`PageViewContext` own unrelated pixels and markup.

Copying the live runtime DOM into Edit is not acceptable. Runtime nodes have no
source identity, continuous synchronization would create another document
authority, and serialized runtime content could contaminate save, review,
version comparison or AI input.

## Decision

- Phase one changes desktop Edit only. Preview and review keep their existing
  authored-page rendering. Review/version comparison continues to compare the
  original HTML.
- `PageViewContext` carries presentation state only. It no longer carries
  Canvas pixels or table HTML.
- A renderer `RuntimeVisualProjectionSession` indexes source-empty hosts in the
  exact current HTML. Its request identity includes document key, source path,
  source Hash, normalized edit viewport and applied presentation entries.
  Debouncing and a monotonic generation discard late results.
- A narrow preload method sends the bounded request to one main-process capture
  controller. The controller reuses the contained `pageroot-preview:` resource
  session, runs the authored page in a hidden sandboxed BrowserWindow, denies
  navigation/popups/webviews and captures the final host rectangle. It is
  renderer-library agnostic: Canvas, SVG, HTML and `tbody` use the same bitmap
  route.
- The response contains bounded PNG data URLs and geometry only. It is accepted
  only for the exact source Hash, a unique known source node and a host that is
  still empty in source.
- `HtmlCanvasEditor` mounts the PNG as pointer-transparent, read-only
  presentation beneath the original instrumented host. An empty `tbody` gets
  one bitmap row. Clicking, selecting and commenting therefore resolve the
  original host TargetRef, never the image.
- Projection nodes and `data-pageroot-*` attributes are disposable. They do not
  enter SourcePatch, browser/source history, save, export, Draft, Version,
  review diff or Request creation. The Bridge still copies the complete exact
  source HTML to `input/base/index.html`; PageRoot merely omits its own temporary
  projection data.
- The projection owns no drain obligation and no runtime-DOM synchronization.
  Project/source/history/mode changes clear it; the next eligible edit viewport
  may request a new one.

## Consequences

Users see script-generated visuals immediately in Edit and can comment on the
corresponding original HTML element without enabling page scripts in the edit
iframe. Text input, comments, review, difference recognition, undo/redo and AI
source authority keep their existing paths. The implementation has one generic
capture boundary instead of per-library adapters or recurring renderer patches.

The bitmap itself is not interactive or editable. Real page interactions still
belong to Preview, and source-authored SVG/HTML remains preferable when users
need to edit visual internals rather than comment on the host.
