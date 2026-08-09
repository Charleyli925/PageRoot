# Runtime Snapshot contract

Runtime snapshots are disposable presentation data. They never become Source
HTML, a `TargetRef`, a review acceptance decision, a Version, a save payload or
AI input. Static Review and source bytes remain available when snapshot capture
does not run, fails, or returns late.

## Supported source hosts

`app/domain/runtime-snapshot-hosts.js` is the single `SourceHostResolver` for
the new path. It starts with `SourceIndex` and `TargetRef`, before authored
scripts execute, and accepts only:

- a direct source `<canvas>`;
- a direct source `<svg>` (including one with authored SVG children);
- a source-empty stable host with a unique `id`, `name`, `aria-label`,
  `data-*` value, or class token.

The resolver pairs the before-side `TargetRef` to the after source. Direct
Canvas/SVG roots may use their exact source path as a conservative fallback;
ordinary source-empty containers never do. A deleted, ambiguous, type-changed,
or non-empty host is omitted. No JavaScript parser, computed selector,
comment-group discovery, or runtime-DOM discovery is part of candidate selection.

The resolver returns source host identity only to trusted renderer memory. It
does not serialize a `TargetRef` or candidate binding into the authored Review
page.

## Snapshot owner

`desktop/runtime-visual-capture-owner.mjs` is the single Review
`RuntimeSnapshotOwner`. For each before or after side it receives only the
exact source HTML, full source SHA-256, side, viewport and bounded source-host
binding. Before scripts run, it validates the raw source path/tag/identity. In
a one-use isolated session it then confirms that exact host still exists and,
for a stable container, that it has visible Canvas/SVG paint.
Each candidate is validated independently: a mismatched binding becomes an
unavailable snapshot and cannot suppress other valid hosts in the same pair.

The owner preserves the containment boundary:

- hidden sandboxed BrowserWindow, no Node, preload or Bridge;
- a disposable non-persistent partition and preview session;
- denied permissions, navigation, popups, downloads, webviews and other URLs;
- main-process deadline, per-page pixel/PNG-byte limits, and forced cleanup.

The owner takes one isolated rect pass and at most one screenshot per supported
host. A returned snapshot is exactly:

```text
candidate key + captured/unavailable + source-side envelope + PNG bytes/hash/size
```

PNG headers, dimensions, byte length, SHA-256, per-page pixels and bytes are
revalidated in trusted renderer memory. Raw DOM and node handles never leave
the owner; the authored page receives no owner channel, candidate binding or
image data.

## Review behavior

After both static Review frames report ready, `AiReviewWorkspace` issues one bounded before/after owner capture. It compares the matching PNG hash and dimensions once. A difference can add one opaque style marker to the existing static outline. An unavailable, malformed, late or mismatched result adds no marker and produces no user-facing state.

There is no second fresh before/after pair, no deterministic confirmation
coordinator, and no user-visible capture/retry/status UI. The owner deadline
is the only capture deadline; static Review never waits for its result.

## Limits and future convergence

`app/domain/runtime-visual-contract.js` remains the shared frozen limit source:
contract version, source/session identity, 1.5-second owner deadline, 32
snapshots, 4,194,304 pixels and 16,000,000 aggregate PNG bytes. The Review
path additionally rejects any individual PNG larger than 2,000,000 bytes.

This milestone establishes the source-host and owner boundary for Review. Edit
still uses its existing projection implementation until the following
convergence milestone moves both consumers onto one bounded last-snapshot cache
and removes the old capture path. No cache or Edit migration is implied here.
