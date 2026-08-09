# Runtime Snapshot contract

Runtime snapshots are disposable presentation data. They never become Source
HTML, a `TargetRef`, a review acceptance decision, a Version, a save payload or
AI input. Source bytes and static Review remain authoritative if capture does
not run, fails, or returns late.

## One source-host resolver

`app/domain/runtime-snapshot-hosts.js` is the only `SourceHostResolver` for
both Edit and Review. Before authored scripts execute, it starts from
`SourceIndex` and `TargetRef` and accepts only:

- a direct source `<canvas>`;
- a direct source `<svg>` (including authored SVG children);
- a source-empty stable host with one unique `id`, `name`, `aria-label`,
  `data-*` value, or class token.

Direct Canvas/SVG roots may use their exact source path as a conservative
fallback. Ordinary source-empty hosts must retain their unique stable binding.
Deleted, ambiguous, type-changed, or non-empty hosts are omitted. Candidate
selection never parses JavaScript, follows a computed selector, consumes a
comment scope, inspects arbitrary HTML/`tbody`, or discovers runtime DOM.

The resolver exposes bindings only to trusted renderer memory. It does not put a
`TargetRef`, candidate binding, or screenshot into authored Edit or Review
documents.

## One snapshot owner

`desktop/runtime-visual-capture-owner.mjs` is the single
`RuntimeSnapshotOwner`. Its one narrow preload route accepts exact source HTML,
full source SHA-256, a side (`edit`, `before`, or `after`), viewport and bounded
source-host bindings. It validates the raw binding before scripts run, then uses
a one-use isolated session to confirm the same rendered host and, for a stable
container, visible Canvas/SVG paint. Each candidate fails independently as an
unavailable snapshot.

The owner always has these containment properties:

- a hidden sandboxed BrowserWindow with no Node, preload or Bridge;
- a disposable non-persistent partition and preview session;
- only main-owned, declared source-relative assets for the active document;
- denied permissions, navigation, popups, downloads, webviews and other URLs;
- one isolated rect pass, at most one PNG per host, bounded PNG/pixel budgets,
  a main-process deadline, and forced cleanup.

It returns only a captured/unavailable key plus an envelope and PNG
bytes/hash/size. Trusted renderer memory revalidates PNG headers, dimensions,
byte length, SHA-256, per-page pixels and aggregate bytes. Raw DOM/node handles
never leave the owner; authored pages receive no owner channel, binding or image
data.

## Edit behavior

`EditRuntimeSnapshotSession` owns Edit's one bounded last-snapshot cache. Its
coarse input hash includes supported host markup plus authored `base`, `link`,
`script`, and `style` sources—not the whole document and not a speculative
JavaScript dependency graph. The cache is additionally keyed by document and a
64px viewport bucket, and is bounded to four entries and 16 MiB.

For ordinary text edits, undo/redo that leaves those inputs unchanged, and
Preview/Edit or tab/mode transitions, the session re-resolves the current
`SourceIndex` and reuses the existing verified image without capture. A changed
runtime input keeps a compatible previous image mounted while one quiet
background owner capture runs; its decoded replacement is swapped in place. A
failed, unavailable, stale, or late replacement clears only the disposable
projection and cannot affect source, selection, IME, comments, save, history,
Review, or AI input.

`HtmlCanvasEditor` mounts a direct Canvas/SVG image as a reversible background
or a stable empty host image as pointer-transparent presentation. It stages a
new Blob URL off-DOM before replacement and revokes retired URLs. The original
source host remains the comment and edit target.

## Review behavior

After both static Review frames are ready, `AiReviewWorkspace` sends one
bounded before/after pair through the same owner and validates the same snapshot
envelope/parser. A difference in matching captured PNGs may add one opaque
style marker to the existing static outline. An unavailable, malformed, late,
or mismatched result adds no marker and has no user-visible capture status.

There is no second fresh pair, deterministic coordinator, review cache, or
capture/retry UI. Static Review never waits for the owner.

## Shared limits

`app/domain/runtime-visual-contract.js` is the frozen production limit source:
contract version, source/session identity, 1.5-second owner deadline, 32
snapshots, 4,194,304 pixels and 16,000,000 aggregate PNG bytes. The shared
snapshot parser additionally rejects an individual PNG over 2,000,000 bytes.
